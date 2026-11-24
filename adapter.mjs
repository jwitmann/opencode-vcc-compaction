/**
 * Hook adapter: OpenCode `Message` values → VCC `CompileNode` values.
 *
 * Pure offline mapping plus compile (no Effect import, no dependencies
 * beyond `./engine/*`, so it unit-tests with plain node). The thin
 * Effect wiring lives in `index.ts`; everything decidable lives here.
 *
 * Vocabulary notes (verified against the v2.3.2 checkout):
 * - `ToolCallPart.input` is already parsed (unknown) upstream, while the
 *   compiler wants a raw JSON string (`parseToolArguments`) — stringify
 *   here, unparseable input falls back to name-only one-liners there.
 * - `ToolResultPart.result` is `{ type, value }`, not blocks — project to
 *   one text block per part (`projectResultValue`). The compiler's
 *   result-pointer pre-pass reads `message.toolCallId` (DSH shape), so the
 *   adapter copies the first tool-result part id onto the node message;
 *   OpenCode parts link by plain `id`. Multi-result messages link the
 *   first part only (documented limitation; the rest still compile).
 * - `CompactionPart` (a prior summary) becomes a synthesized user node
 *   with `source: { kind: "compact-checkpoint" }` — the shape the
 *   compiler's checkpoint branch matches. Null-text compaction parts,
 *   effort parts, and system-role messages are skipped (transient or
 *   empty; documented).
 * - Message `metadata` is NOT projected (read-only stored metadata, never
 *   DSH `source` shapes).
 * - seqs are 1-based ordinals over the adapted nodes (contiguous:
 *   skipped messages consume no seq). The summary's
 *   `(seq N)` pointers are positional; OpenCode-native recall (message /
 *   part IDs) is follow-up work, not this adapter.
 * - `keepID` must be a message id present in the request (the host splits
 *   history at `message.id === keepID`). When no id exists at/after the
 *   cut, `compileCompaction` returns undefined and the hook abstains —
 *   the host falls back to model compaction. Never a broken summary.
 * - The emitted `summary` is a one-line label (the TUI renders only the
 *   summary, so the row collapses to one line instead of a multi-KB wall).
 *   The full checkpoint travels in `native.messages` and replays instead of
 *   the summary. `wrapCheckpointSummary` / `unwrapCheckpointSummary` remain
 *   for checkpoints persisted by older versions — `toNode` strips one
 *   wrapper layer on re-entry and reattaches the checkpoint source to a
 *   replayed native window (plain user message carrying the compiler's own
 *   `<compacted-checkpoint>` tags), so repeated compactions carry the prior
 *   checkpoint verbatim instead of re-summarizing it — and a shape mismatch
 *   keeps the text verbatim (fail-safe, never a dropped checkpoint).
 */
import {
  COMPILER_REV,
  compileNoisePatterns,
  compileRegion,
  frameCheckpoint,
} from "./engine/compile.mjs";

/** Upstream engine defaults (`src/index.js` in dsh-compaction-vcc@0.7.4). */
export const DEFAULT_PLUGIN_CONFIG = Object.freeze({
  maxTokens: 8192,
  textTokens: 8192,
  userTextTokens: 16384,
  toolCallTokens: 128,
  toolResultExcerptTokens: 256,
  // Asymmetric cut (docs/research/asymmetric-cut-design.md): failures keep
  // a larger excerpt budget than successes (successes are one recall away,
  // failures are not). Default equals the success budget, so stock behavior
  // is byte-identical until the owner tunes it.
  toolErrorExcerptTokens: 256,
  // Pointer-only threshold for huge SUCCESS results (token count above
  // which the entry collapses to a recall pointer). Off by default
  // (Infinity) so stock behavior is byte-identical. Errors are never
  // pointer-collapsed — see the fail-open rule in the design doc.
  toolResultPointerTokens: Infinity,
  includeReasoning: false,
  hideTools: [],
  noisePatterns: [],
  keepMessages: 6,
  // Storage-write bounds (NOT compile knobs): how much history the
  // snapshot store retains across compactions. Distinct from
  // keepMessages (compile tail per summary). Tunable via options;
  // the module constants in snapshot.mjs mirror these defaults.
  snapshotMaxMessages: 50,
  snapshotFullPayloadMessages: 20,
});

/**
 * Project one OpenCode tool-result value to plain text for a text block.
 * @param result - `{ type, value }` tool-result value (may be absent).
 * @returns projected text (possibly empty).
 */
export function projectResultValue(result) {
  if (result === null || result === undefined) return "";
  if (typeof result !== "object") return String(result);
  const value = result.value;
  switch (result.type) {
    case "text":
      return typeof value === "string" ? value : String(value);
    case "error":
      return `[error] ${String(value)}`;
    case "content": {
      if (!Array.isArray(value)) return String(value);
      return value
        .map((block) => {
          if (block === null || block === undefined) return "";
          if (block.type === "text") return block.text ?? "";
          if (block.type === "file") return `[file ${block.name ?? block.uri ?? "attachment"}]`;
          return `[${String(block.type)}]`;
        })
        .filter((text) => text.length > 0)
        .join("\n");
    }
    case "json":
    default:
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
  }
}

/**
 * Stringify a tool-call input the same way everywhere (adapter + snapshot).
 * Absent input yields "" (never the literal "null").
 * @param input - raw tool-call input (string, JSON value, or absent).
 * @returns stringified arguments.
 */
export function stringifyToolInput(input) {
  if (input === undefined || input === null) return "";
  try {
    return typeof input === "string" ? input : JSON.stringify(input) ?? "";
  } catch {
    return "";
  }
}

/**
 * Classify a media part as image/document label (bytes never stored).
 * Accepts OpenCode parts (`part.media.*`) and cleaned snapshot parts
 * (`part.mediaType`).
 * @param part - media-ish part.
 * @returns "image" or "document".
 */
export function mediaLabel(part) {
  const mime = part?.media?.mediaType ?? part?.media?.mime ?? part?.mediaType ?? "";
  return typeof mime === "string" && mime.startsWith("image/") ? "image" : "document";
}

/**
 * Map one content part to a compiler block, or null to drop it.
 * @param part - OpenCode content part.
 * @returns compiler block or null.
 */
function toBlock(part) {
  if (part === null || part === undefined) return null;
  if (typeof part.type !== "string") return null;
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text ?? "" };
    case "reasoning":
      return { type: "reasoning", text: part.text ?? "" };
    case "tool-call": {
      return { type: "tool-call", id: part.id ?? "", name: part.name ?? "unknown", arguments: stringifyToolInput(part.input) };
    }
    case "tool-result":
      return { type: "text", text: projectResultValue(part.result) };
    case "media": {
      return { type: mediaLabel(part) };
    }
    case "compaction":
    case "effort":
      return null;
    default:
      return { type: String(part.type) };
  }
}

/**
 * Wrap one compiled checkpoint in a single HTML `<details>` layer (legacy
 * shape, kept for checkpoints persisted by older versions — see
 * `unwrapCheckpointSummary`). New outcomes emit the one-line label as the
 * summary and the bare checkpoint in `native.messages` instead.
 * @param body - framed checkpoint text.
 * @param label - single-line summary label (must be non-empty: the
 *   unwrapper rejects empty/multiline labels, so the round-trip is exact
 *   only for labels that satisfy this).
 * @returns wrapped text (inverse of `unwrapCheckpointSummary` for valid labels).
 */
export function wrapCheckpointSummary(body, label) {
  return `<details>\n<summary>${label}</summary>\n\n${body}\n\n</details>`;
}

/**
 * Strip one wrapper layer from a prior checkpoint on re-entry.
 * Accepts only our exact shape with a single-line label; anything else
 * (plain text, host-edited, mangled) passes through verbatim so a
 * checkpoint is never dropped or rewritten by a guess.
 * @param text - prior checkpoint body (possibly wrapped).
 * @returns inner body, or the input unchanged.
 */
export function unwrapCheckpointSummary(text) {
  if (typeof text !== "string") return text;
  const open = "<details>\n<summary>";
  const mid = "</summary>\n\n";
  const close = "\n\n</details>";
  if (!text.startsWith(open)) return text;
  const labelEnd = text.indexOf(mid, open.length);
  if (labelEnd === -1) return text;
  const label = text.slice(open.length, labelEnd);
  if (label.length === 0 || label.includes("\n")) return text;
  if (!text.endsWith(close)) return text;
  return text.slice(labelEnd + mid.length, text.length - close.length);
}

/**
 * Map one request message to a compiler node, or null to skip it.
 * @param message - OpenCode request message (`{ id?, role, content }`).
 * @param seq - 1-based ordinal for this message.
 * @returns compile node or null.
 */
export function toNode(message, seq) {
  if (message === null || message === undefined) return null;
  if (!Array.isArray(message.content)) return null;
  if (message.role === "system") return null;
  if (message.role === "assistant") {
    const live = message.content.filter((block) => block !== null && block !== undefined);
    if (live.length === 1 && live[0].type === "compaction") {
      const raw = live[0].text;
      const text = unwrapCheckpointSummary(raw);
      if (typeof text !== "string" || text.length === 0) return null;
      return { seq, message: { role: "user", content: [{ type: "text", text }], source: { kind: "compact-checkpoint" } } };
    }
  }
  const blocks = [];
  for (const part of message.content) {
    const block = toBlock(part);
    if (block !== null) blocks.push(block);
  }
  if (message.role === "assistant") {
    if (blocks.length === 0) return { seq, message: { role: "assistant", content: [] } };
    return { seq, message: { role: "assistant", content: blocks } };
  }
  if (message.role === "tool") {
    const first = message.content.find((part) => part !== null && part !== undefined && part.type === "tool-result");
    const node = { seq, message: { role: "tool", content: blocks } };
    if (first !== undefined && typeof first.id === "string" && first.id !== "") node.message.toolCallId = first.id;
    // Asymmetric cut: flag failure results on the structured `result.type`
    // signal (never the "[error] " text prefix — a user quoting an error
    // must not be mistaken for one). Absent on success so success-node
    // goldens stay byte-identical.
    if (
      message.content.some(
        (part) =>
          part !== null &&
          part !== undefined &&
          part.type === "tool-result" &&
          part.result !== null &&
          typeof part.result === "object" &&
          part.result.type === "error",
      )
    )
      node.message.isError = true;
    return node;
  }
  if (message.role === "user") {
    // Replayed native window: the host returns our checkpoint as an
    // ordinary user message (no `source`). Detect the compiler's own
    // `<compacted-checkpoint>` tag pair and reattach the checkpoint source
    // so the engine carries it verbatim ([system] entry, dropped last)
    // instead of re-chunking it as ordinary user prose. Detection is on
    // the machine tag pair, never on prose — and either way the full text
    // is preserved, only the entry framing differs.
    if (
      blocks.length === 1 &&
      blocks[0].type === "text" &&
      typeof blocks[0].text === "string" &&
      blocks[0].text.includes("<compacted-checkpoint>") &&
      blocks[0].text.includes("</compacted-checkpoint>")
    ) {
      return { seq, message: { role: "user", content: blocks, source: { kind: "compact-checkpoint" } } };
    }
    return { seq, message: { role: "user", content: blocks } };
  }
  return null;
}

/**
 * Pick the keepID: id of the first tailed message (scan forward past
 * id-less messages from the cut point).
 * @param messages - request messages in order.
 * @param keepMessages - how many trailing messages stay verbatim.
 * @returns the keepID, or undefined when no id exists at/after the cut.
 */
export function pickKeepID(messages, keepMessages) {
  const list = Array.isArray(messages) ? messages : [];
  const keep = Number.isFinite(keepMessages) ? Math.max(1, Math.floor(keepMessages)) : DEFAULT_PLUGIN_CONFIG.keepMessages;
  const cut = Math.max(0, list.length - keep);
  for (let index = cut; index < list.length; index += 1) {
    const id = list[index]?.id;
    if (typeof id === "string" && id !== "") return id;
  }
  return undefined;
}

/**
 * Resolve user options (opencode.jsonc `{package, options}` object form)
 * against the upstream engine defaults. Unknown keys are ignored;
 * invalid values fall back to defaults. Invalid noise patterns throw
 * (fail fast at setup, never a silent no-strip).
 * @param options - `ctx.options` (possibly absent).
 * @returns full compiler config.
 */
export function buildConfig(options) {
  const input = options !== null && typeof options === "object" ? options : {};
  const num = (key) => {
    const value = input[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_PLUGIN_CONFIG[key];
  };
  const hideTools = Array.isArray(input.hideTools)
    ? input.hideTools.filter((name) => typeof name === "string")
    : [];
  const noiseSources = Array.isArray(input.noisePatterns)
    ? input.noisePatterns.filter((source) => typeof source === "string")
    : [];
  return {
    maxTokens: num("maxTokens"),
    textTokens: num("textTokens"),
    userTextTokens: num("userTextTokens"),
    toolCallTokens: num("toolCallTokens"),
    toolResultExcerptTokens: num("toolResultExcerptTokens"),
    toolErrorExcerptTokens: num("toolErrorExcerptTokens"),
    toolResultPointerTokens: num("toolResultPointerTokens"),
    includeReasoning: input.includeReasoning === true,
    hideTools,
    noisePatterns: compileNoisePatterns(noiseSources),
    keepMessages: num("keepMessages"),
    snapshotMaxMessages: num("snapshotMaxMessages"),
    snapshotFullPayloadMessages: num("snapshotFullPayloadMessages"),
  };
}

/**
 * Stable hash of a resolved config for metadata stamping (lets later
 * sessions tell which engine rev + config produced a checkpoint).
 * Pure and dependency-free (FNV-1a over a normalized projection):
 * compiled `noisePatterns` RegExps hash by source + flags (they are not
 * JSON-stable) and non-finite numbers by name. Unhashable input
 * (circular, BigInt) hashes to `00000000` rather than throwing, so the
 * stamp can never veto a compaction.
 * @param config - resolved config from `buildConfig`.
 * @returns 8 lowercase hex chars; stable for equal configs.
 */
export function configHash(config) {
  const input = config !== null && typeof config === "object" ? config : {};
  let normalized;
  try {
    normalized = JSON.stringify(input, (_key, value) => {
      if (value instanceof RegExp) return `regexp:${value.source}/${value.flags}`;
      if (typeof value === "number" && !Number.isFinite(value)) return `nonfinite:${String(value)}`;
      return value;
    }) ?? "{}";
  } catch {
    return "00000000";
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Validate a compiled outcome before the hook installs it (the
 * validate-before-install discipline: never install an invalid summary).
 * The compiler is deterministic, so there is nothing a retry could fix —
 * an invalid outcome abstains straight to host fallback, exactly like
 * the id-less abstain path. Checks only what the host needs to take the
 * result: a non-blank one-line summary, a non-blank checkpoint window,
 * and a non-empty keepID.
 * @param outcome - `compileCompaction` result (or anything else on failure paths).
 * @returns true when the outcome is safe to install as `event.result`.
 */
export function isValidCompactionOutcome(outcome) {
  if (outcome === null || outcome === undefined || typeof outcome !== "object") return false;
  if (typeof outcome.summary !== "string" || outcome.summary.trim().length === 0) return false;
  if (typeof outcome.checkpoint !== "string" || outcome.checkpoint.trim().length === 0) return false;
  if (typeof outcome.keepID !== "string" || outcome.keepID.trim() === "") return false;
  return true;
}

/**
 * Compile one compaction request deterministically.
 *
 * The `summary` is a one-line label: the TUI renders only the summary, so
 * the row collapses to one line. The full checkpoint (`checkpoint`) is the
 * context payload — the hook installs it as the single-message
 * `native.messages` window, which the host replays instead of the summary.
 * @param messages - request messages in order.
 * @param config - resolved config from `buildConfig`.
 * @returns `{ summary, checkpoint, keepID, stats, capped, vccRev, vccConfigHash }`,
 *   or undefined to abstain (no id at/after the cut — the hook must leave
 *   `result` unset).
 */
export function compileCompaction(messages, config = buildConfig({})) {
  const list = Array.isArray(messages) ? messages : [];
  const nodes = [];
  for (const message of list) {
    const node = toNode(message, nodes.length + 1);
    if (node !== null) nodes.push(node);
  }
  const keepID = pickKeepID(list, config.keepMessages);
  if (keepID === undefined) return undefined;
  const region = compileRegion(nodes, config);
  const headerLine = `[opencode-vcc-compaction ${COMPILER_REV}: ${nodes.length} messages -> ${region.entries.length} entries]`;
  const footerLine = region.capped === true
    ? [`[cap enforced at ${config.maxTokens} entry tokens]`]
    : undefined;
  const checkpoint = frameCheckpoint(region.entries, headerLine, undefined, footerLine)
    .map((block) => block.text)
    .join("\n\n");
  const summary = `compaction checkpoint: ${nodes.length} messages -> ${region.entries.length} entries`;
  return {
    summary,
    checkpoint,
    keepID,
    stats: region.stats,
    capped: region.capped,
    vccRev: COMPILER_REV,
    vccConfigHash: configHash(config),
  };
}
