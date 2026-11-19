/**
 * Tokenizer + token-budget primitives, ported from
 * dsh-compaction-vcc@0.7.4 `src/compiler.js` (MIT:
 * Copyright (c) 2026 TsFreddie, Copyright (c) 2026 Tingfeng).
 *
 * Faithful port with two documented deviations:
 * - `tailTokens` is exported here (module-private upstream) so the
 *   sibling compile stage can import it across the file split.
 * - No DSH imports (upstream module is already dependency-free).
 *
 * Note on style: this file keeps upstream's semicolons verbatim for
 * line-for-line comparability with the MIT source (present and future
 * re-sync). This coincides with the repo's own `.mjs` style
 * (`compiler/selftest.mjs`, `scripts/check-engine-sync.mjs` both use
 * semicolons), so there is no style conflict in practice.
 *
 * Everything below is deterministic and offline: same input text always
 * yields the same tokens, counts, and slices.
 */

// ── tokenizer (VCC `_tokenize` / `_TOK_RE`) ────────────────────────────────

const TOKEN_RE = /[a-zA-Z]+|[0-9]+|[^\sa-zA-Z0-9]|\s+/g;

/** Whether a UTF-16 code unit can be an unpaired high surrogate. */
function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Whether a UTF-16 code unit can be an unpaired low surrogate. */
function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Move the end of a slice to a code-point boundary: a cut must never leave a
 * high surrogate without its low half.
 */
function completeCodePointAtEnd(text) {
  return isHighSurrogate(text.charCodeAt(text.length - 1)) ? text.slice(0, -1) : text;
}

/**
 * Move the start of a slice to a code-point boundary (a tail excerpt must
 * never begin inside a surrogate pair).
 */
function completeCodePointAtStart(text) {
  return isLowSurrogate(text.charCodeAt(0)) ? text.slice(1) : text;
}
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const CTRL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/**
 * Split text into fixed-density tokens: letter runs, digit runs, single
 * punctuation chars, and whitespace runs. Whitespace tokens are included
 * in the list but never counted by {@link countTokens}.
 */
export function tokenize(text) {
  return text.match(TOKEN_RE) ?? [];
}

/**
 * True when the character carries the 0.6 CJK weight. Name kept for API
 * stability; it means "CJK-density character" (kana, hangul, Thai, Lao,
 * Indic scripts included — same density class, not ideographs only).
 */
export function isCjkChar(char) {
  const code = char.codePointAt(0);
  return (
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
    (code >= 0xff00 && code <= 0xffef) || // Fullwidth Forms
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
    (code >= 0x31f0 && code <= 0x31ff) || // Katakana Phonetic Extensions
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
    (code >= 0x0e00 && code <= 0x0e7f) || // Thai
    (code >= 0x0e80 && code <= 0x0eff) || // Lao
    (code >= 0x0900 && code <= 0x097f) || // Devanagari
    (code >= 0x0980 && code <= 0x09ff) || // Bengali
    (code >= 0x0a00 && code <= 0x0a7f) || // Gurmukhi
    (code >= 0x0a80 && code <= 0x0aff) || // Gujarati
    (code >= 0x0b00 && code <= 0x0b7f) || // Oriya
    (code >= 0x0b80 && code <= 0x0bff) || // Tamil
    (code >= 0x0c00 && code <= 0x0c7f) || // Telugu
    (code >= 0x0c80 && code <= 0x0cff) || // Kannada
    (code >= 0x0d00 && code <= 0x0d7f) || // Malayalam
    (code >= 0x0d80 && code <= 0x0dff) || // Sinhala
    (code >= 0x1000 && code <= 0x109f) || // Myanmar
    (code >= 0x1780 && code <= 0x17ff)    // Khmer
  );
}

/**
 * Estimate tokens under the character-density conversion (0.3 per
 * non-CJK character, 0.6 per CJK character). Integer tenths, exact
 * under ceil for long inputs.
 */
export function estimateDeepSeekTokens(text) {
  let nonCjk = 0;
  let cjk = 0;
  for (const char of text) {
    if (isCjkChar(char)) cjk += 1;
    else nonCjk += 1;
  }
  return (nonCjk * 3 + cjk * 6) / 10;
}

/** Count the non-whitespace tokens of a text under {@link tokenize}. */
export function countTokens(text) {
  let count = 0;
  for (const token of tokenize(text)) if (token.trim().length > 0) count += 1;
  return count;
}

/**
 * Size one emitted entry the way every budget in this module is enforced:
 * the word-class token count, floored at the character-density equivalent
 * so the total cap also sees pathological long runs.
 */
export function estimateEntryTokens(text) {
  return Math.max(countTokens(text), Math.ceil(estimateDeepSeekTokens(text)));
}

/**
 * Strip carriage returns, ANSI escapes, and control bytes — deterministic
 * cleanup, never token-changing rewrites.
 */
export function sanitize(text) {
  if (typeof text !== "string") return "";
  let out = text;
  if (out.includes("\r")) out = out.replaceAll("\r", "");
  if (out.includes("\x1b")) out = out.replace(ANSI_RE, "");
  return out.replace(CTRL_RE, "");
}

// ── truncation (VCC `_trunc`) ──────────────────────────────────────────────

/**
 * Truncate text to a non-whitespace-token budget, preserving exact original
 * tokens and appending a provenance note on a cut. Every budget is enforced
 * twice — by token count AND by a `limit * 4` character ceiling (floor 32),
 * so pathological unbroken runs (base64 blobs, minified files) cannot pass.
 */
export function truncateTokens(text, limit, ref) {
  const tokens = tokenize(text);
  let count = 0;
  let cut = tokens.length;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.trim().length === 0) continue;
    count += 1;
    if (count > limit) {
      cut = index;
      break;
    }
  }
  let out = cut >= tokens.length ? text : tokens.slice(0, cut).join("");
  let truncated = cut < tokens.length;
  const maxChars = Math.max(32, limit * 4);
  if (out.length > maxChars) {
    out = completeCodePointAtEnd(out.slice(0, maxChars));
    truncated = true;
  } else if (truncated) {
    out = completeCodePointAtEnd(out);
  }
  if (!truncated) return { text, truncated: false };
  out = out.replace(/\s+$/u, "");
  const note = ref === undefined ? "...(truncated)" : `...(truncated from ${ref})`;
  return { text: out + note, truncated: true };
}

/**
 * Keep the LAST `limit` non-whitespace tokens of a text, additionally capped
 * at `limit * 4` characters. The end of the text is always preserved.
 */
export function tailTokens(text, limit, ref) {
  const tokens = tokenize(text);
  let count = 0;
  let startIdx = tokens.length;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index].trim().length > 0) {
      count += 1;
      if (count > limit) break;
    }
    startIdx = index;
  }
  let out = startIdx === 0 ? text : tokens.slice(startIdx).join("");
  let truncated = startIdx > 0;
  const maxChars = Math.max(32, limit * 4);
  if (out.length > maxChars) {
    out = completeCodePointAtStart(out.slice(out.length - maxChars));
    truncated = true;
  } else if (truncated) {
    out = completeCodePointAtStart(out);
  }
  if (!truncated) return { text, truncated: false };
  const note = ref === undefined ? "...(elided before)" : `...(elided before ${ref})`;
  return { text: note + out, truncated: true };
}
