/**
 * Keyword/regex search over the durable session log, ported from
 * dsh-compaction-vcc@0.7.4 `src/search.js` (MIT: Copyright (c) 2026
 * TsFreddie, Copyright (c) 2026 Tingfeng) — the retrieval counterpart of
 * the compiler: scans every event's projected content, returns matching
 * events with `(seq N)` pointers that `recall` restores in full.
 *
 * Faithful port with two documented deviations:
 * - Upstream imports are split across the sibling stages: budget
 *   primitives from `./tokenize.mjs` (`estimateEntryTokens`, `sanitize`,
 *   `truncateTokens`), message projection from `./recall.mjs`
 *   (`projectMessageText`), session access from `./session-compat.mjs`
 *   (`sessionEventAt`, `sessionEvents`) — nothing re-defined here.
 *   (`sessionEventAt` is imported but unused, exactly as upstream.)
 * - Known upstream quirk carried verbatim: the scan is positional
 *   (`events[seq]` with `event.seq === seq`, so a 1-based log in a
 *   0-based array matches nothing). The future adapter's event list must
 *   satisfy this; not papered over here.
 *
 * Upstream semicolons kept verbatim, per the repo `.mjs` convention
 * (see `compiler/compile.mjs` header).
 *
 * Everything below is deterministic and offline: same session + pattern
 * always yields the same hits, with no model call.
 */
import { estimateEntryTokens, sanitize, truncateTokens } from "./tokenize.mjs";
import { projectMessageText } from "./recall.mjs";
import { sessionEventAt, sessionEvents } from "./session-compat.mjs";

/** Default cap on the number of matching events shown in one result. */
export const DEFAULT_MAX_SEARCH_HITS = 50;
/** Default cap on shown matching lines per hit event. */
export const MAX_LINES_PER_HIT = 10;

/** A search pattern that cannot be compiled into a regular expression. */
export class InvalidSearchPatternError extends Error {
  /**
   * @param source - the raw pattern the user supplied.
   * @param reason - the regex compiler's message.
   */
  constructor(source, reason) {
    super(`invalid search pattern ${JSON.stringify(String(source))}: ${reason}`);
    this.source = String(source);
  }
}

/**
 * Compile one search pattern: case-insensitive, Unicode-aware, treated as a
 * regular expression (VCC `--grep` semantics) so keywords work as-is and
 * regexes work when escaped.
 * @param source - raw pattern text.
 * @returns the compiled pattern.
 * @throws InvalidSearchPatternError when empty or not compilable.
 */
export function compileSearchPattern(source) {
  const trimmed = String(source ?? "").trim();
  if (trimmed.length === 0) throw new InvalidSearchPatternError(source, "pattern is empty");
  try {
    return new RegExp(trimmed, "iu");
  } catch (error) {
    throw new InvalidSearchPatternError(source, error instanceof Error ? error.message : String(error));
  }
}

/** One search hit: the durable seq, its kind, and the rendered matched lines. */
export function searchSession(session, patternSource, config) {
  const pattern = compileSearchPattern(patternSource);
  const maxHits = config.maxSearchHits;
  const maxTokens = config.maxRecallTokens;
  const events = sessionEvents(session);
  const hits = [];
  let totalMatches = 0;
  let budget = maxTokens;
  let truncated = false;
  for (let seq = 0; seq < events.length; seq += 1) {
    const event = events[seq];
    if (event === undefined || event.seq !== seq) continue;
    const message = typeof session.deriveEventMessage === "function" ? session.deriveEventMessage(event) : null;
    const body = message !== null
      ? projectMessageText(message)
      : `[${event.type}]\n${JSON.stringify(event.data ?? null)}`;
    const lines = body.split("\n");
    const matched = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (pattern.test(lines[index])) matched.push({ line: index + 1, text: sanitize(lines[index]) });
    }
    if (matched.length === 0) continue;
    totalMatches += 1;
    if (hits.length >= maxHits || budget <= 0) {
      truncated = true;
      continue;
    }
    const header = `[seq ${seq}: ${message !== null ? message.role : event.type}]`;
    const shown = matched.slice(0, MAX_LINES_PER_HIT);
    const more = matched.length - shown.length;
    const block = [
      header,
      ...shown.map((match) => `  ${match.line}: ${match.text}`),
      ...(more > 0 ? [`  ...(${more} more matching lines in this event)`] : [])
    ].join("\n");
    const kept = truncateTokens(block, budget, "search budget");
    budget -= estimateEntryTokens(kept.text);
    if (kept.truncated) truncated = true;
    hits.push({ seq, kind: message !== null ? message.role : event.type, text: kept.text });
  }
  const omitted = totalMatches - hits.length;
  const lines = [
    `[search "${pattern.source}": ${totalMatches} matching event(s)]`,
    ...hits.map((hit) => hit.text),
    ...(omitted > 0 ? [`[${omitted} more matching event(s) omitted — narrow the pattern or use recall]`] : []),
    ...(truncated ? ["[search budget exhausted; some hits were cut]"] : [])
  ];
  if (hits.length > 0) lines.push("[use recall with a (seq N) pointer to restore any hit's full original content]");
  const text = lines.join("\n\n");
  return {
    pattern: pattern.source,
    totalMatches,
    hits,
    omitted,
    truncated,
    tokens: hits.reduce((total, hit) => total + estimateEntryTokens(hit.text), 0),
    text
  };
}
