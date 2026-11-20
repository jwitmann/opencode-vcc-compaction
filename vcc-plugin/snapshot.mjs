/**
 * Snapshot store for vcc- commands: cleaned raw messages + session view.
 *
 * Why cleaned raw (not projected nodes): `toNode` bakes in config
 * (`includeReasoning`, `hideTools`) and elides for compile budgets. Recall
 * is the lossless counterpart, so the snapshot keeps full text, reasoning,
 * raw tool-call input, and full tool-result values for the known part
 * vocabulary — stripping only transport bloat (`cache`, `metadata`,
 * `providerMetadata`) and media bytes (recall renders media as labels
 * anyway, via the shared `mediaLabel` helper); unknown future part types
 * are label-only. Readers re-project through `toNode` for seq assignment, so
 * recall/search seqs are by construction identical to checkpoint
 * `(seq N)` pointers. `cleanPart` intentionally mirrors `toBlock`
 * (adapter.mjs): lossless store vs lossy compile projection — do not
 * "unify" them; shared tables (`stringifyToolInput`, `mediaLabel`,
 * `projectResultValue`) are imported, the keep/drop rules differ on purpose.
 *
 * System messages are dropped at write time (transient preamble, never
 * compiled, never sequenced). Effort parts are dropped (transient effort
 * updates; compile keeps the message shell with empty content so seqs
 * still align).
 *
 * Event shape: `{ seq, type, data: { message, source? } }` where `seq` is
 * the 1-based ordinal over `toNode`-kept messages (skipped messages consume
 * no seq — same rule as the checkpoint header). Types: user messages get
 * `user/message`, assistant `assistant/message`, tool `tool/result` (so
 * `result N` refs resolve), and synthesized checkpoints `user/message`
 * with `source: { kind: "compact-checkpoint" }` (so `findCheckpointSeqs`
 * and `checkpoint N` refs work).
 *
 * Search deviation (documented): upstream `search.mjs` scans positionally
 * (`events[seq]` with `event.seq === seq`, 0-based) over the array the
 * session yields, which can never match 1-based seqs. `searchSnapshot`
 * pads a dummy seq-0 entry so the verbatim `searchSession` contract holds,
 * then delegates — no forked search loop to hand-sync. Same hits, honest
 * seqs.
 *
 * The session log is append-only: `snapshotNeedsWrite` is a growth guard
 * (version/count/lastID). In-place edits to middle messages are not
 * detected by design. Imports come from the vendored `./engine/` (ships in
 * the tarball), never `../compiler/`.
 */

import { mediaLabel, projectResultValue, stringifyToolInput, toNode } from "./adapter.mjs";
import {
  DEFAULT_MAX_RECALL_TOKENS,
  recallSession,
  resolveRecallReference,
} from "./engine/recall.mjs";
import {
  DEFAULT_MAX_SEARCH_HITS,
  searchSession,
} from "./engine/search.mjs";

/** Re-exported so command wiring imports only `snapshot.mjs`, never `./engine/` directly. */
export { COMPILER_REV } from "./engine/compile.mjs";

export const SNAPSHOT_VERSION = 1;

/** Storage key prefix; full key is `${SNAPSHOT_KEY_PREFIX}${sessionID}`. */
export const SNAPSHOT_KEY_PREFIX = "vcc-snapshot/";

/**
 * Strip one content part to its storable core.
 * @param part - OpenCode content part.
 * @returns cleaned part, or null to drop.
 */
export function cleanPart(part) {
  if (part === null || part === undefined) return null;
  if (typeof part.type !== "string") return null;
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text ?? "" };
    case "reasoning":
      return { type: "reasoning", text: part.text ?? "" };
    case "tool-call":
      return {
        type: "tool-call",
        id: typeof part.id === "string" ? part.id : "",
        name: typeof part.name === "string" ? part.name : "unknown",
        ...(part.input === undefined ? {} : { input: part.input }),
      };
    case "tool-result":
      return {
        type: "tool-result",
        id: typeof part.id === "string" ? part.id : "",
        name: typeof part.name === "string" ? part.name : "unknown",
        result: part.result ?? null,
      };
    case "media": {
      const mime = part.media?.mediaType ?? part.media?.mime ?? "";
      return {
        type: "media",
        mediaType: typeof mime === "string" ? mime : "",
      };
    }
    case "compaction":
      return typeof part.text === "string" && part.text.length > 0
        ? { type: "compaction", text: part.text }
        : null;
    case "effort":
      return null;
    default:
      return { type: String(part.type) };
  }
}

/**
 * Strip one request message to its storable core. System role and
 * empty/invalid content are dropped (never compiled, never sequenced).
 * @param message - OpenCode request message.
 * @returns cleaned message, or null to drop.
 */
export function cleanMessage(message) {
  if (message === null || message === undefined) return null;
  if (!Array.isArray(message.content)) return null;
  if (message.role === "system") return null;
  const id = typeof message.id === "string" && message.id !== "" ? message.id : undefined;
  if (message.role === "assistant") {
    const live = message.content.filter(
      (block) => block !== null && block !== undefined,
    );
    if (live.length === 1 && live[0]?.type === "compaction") {
      const text = live[0].text;
      if (typeof text !== "string" || text.length === 0) return null;
      return {
        ...(id === undefined ? {} : { id }),
        role: "assistant",
        content: [{ type: "compaction", text }],
      };
    }
    const content = [];
    for (const part of message.content) {
      const cleaned = cleanPart(part);
      if (cleaned !== null) content.push(cleaned);
    }
    return {
      ...(id === undefined ? {} : { id }),
      role: "assistant",
      content,
    };
  }
  const content = [];
  for (const part of message.content) {
    const cleaned = cleanPart(part);
    if (cleaned !== null) content.push(cleaned);
  }
  // Mirror toNode: user/tool shells are kept even when empty (they consume a
  // seq on the compile side); only system/empty-invalid messages are dropped.
  return {
    ...(id === undefined ? {} : { id }),
    role: message.role,
    content,
  };
}

/**
 * Build a snapshot from request messages.
 * @param messages - request messages in order.
 * @returns `{ version, messages, count, lastID }`.
 */
export function buildSnapshot(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const cleaned = [];
  for (const message of list) {
    const kept = cleanMessage(message);
    if (kept !== null) cleaned.push(kept);
  }
  let lastID;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    if (typeof cleaned[index].id === "string" && cleaned[index].id !== "") {
      lastID = cleaned[index].id;
      break;
    }
  }
  return {
    version: SNAPSHOT_VERSION,
    messages: cleaned,
    count: cleaned.length,
    lastID,
  };
}

/**
 * Parse a `/vcc-recall` invocation into a typed recall reference.
 * Strips a leading `/vcc-recall` command prefix when present.
 * @param text - raw invocation prompt text.
 * @returns `{ type, id }`, or `{ error }` with usage text.
 */
export function parseRecallArgs(text) {
  const raw = String(text ?? "").replace(/^\s*\/vcc-recall\b/iu, "").trim();
  if (raw.length === 0) return { error: "usage: /vcc-recall <seq selection> | result <ref> | checkpoint <ref> (e.g. `/vcc-recall 3-7`, `/vcc-recall result 3`, `/vcc-recall checkpoint 1`)" };
  const lowered = raw.toLowerCase();
  if (lowered === "result" || lowered.startsWith("result ")) {
    const id = raw.slice(6).trim();
    if (id.length === 0) return { error: "usage: /vcc-recall result <seq> (e.g. `/vcc-recall result 3`)" };
    return { type: "result", id };
  }
  if (lowered === "checkpoint" || lowered.startsWith("checkpoint ")) {
    const id = raw.slice(10).trim();
    if (id.length === 0) return { error: "usage: /vcc-recall checkpoint <ordinal|seq> (e.g. `/vcc-recall checkpoint 1`)" };
    return { type: "checkpoint", id };
  }
  return { type: "seq", id: raw };
}

/**
 * Resolve a parsed recall reference against snapshot messages.
 * Thin wrapper over engine `resolveRecallReference` (via
 * `makeSnapshotSession`) so command wiring imports only `snapshot.mjs`.
 * @param cleanedMessages - snapshot `messages`.
 * @param type - reference type: `seq`, `result`, or `checkpoint`.
 * @param id - type-dependent reference text.
 * @returns `{ selections, errors }`.
 */
export function resolveRecallSelections(cleanedMessages, type, id) {
  return resolveRecallReference(makeSnapshotSession(cleanedMessages), type, id);
}

/**
 * Strip a `/vcc-search` command prefix, returning the raw pattern.
 * @param text - raw invocation prompt text.
 * @returns `{ pattern }`, or `{ error }` with usage text.
 */
export function parseSearchArgs(text) {
  const pattern = String(text ?? "").replace(/^\s*\/vcc-search\b/iu, "").trim();
  if (pattern.length === 0) return { error: "usage: /vcc-search <keyword-or-regex> (e.g. `/vcc-search login`)" };
  return { pattern };
}

/**
 * Format a `/vcc-status` reply from the stored snapshot and live config.
 * Pure (caller supplies `now`); never throws on malformed snapshots.
 * @param stored - storage value (`{ version, messages, count, lastID, writtenAt }` or undefined).
 * @param config - resolved plugin config from `buildConfig`.
 * @param rev - engine revision string.
 * @param now - current epoch ms (for age computation).
 * @returns status text.
 */
export function formatStatusText(stored, config, rev, now) {
  const lines = [`**/vcc-status** — opencode-vcc-compaction (engine ${rev})`];
  const cfg = config !== null && typeof config === "object" ? config : {};
  const maxTokens = typeof cfg.maxTokens === "number" ? cfg.maxTokens : "?";
  const keepMessages = typeof cfg.keepMessages === "number" ? cfg.keepMessages : "?";
  const reasoning = cfg.includeReasoning === true ? "on" : "off";
  const hide = Array.isArray(cfg.hideTools) ? cfg.hideTools.length : 0;
  const noise = Array.isArray(cfg.noisePatterns) ? cfg.noisePatterns.length : "?";
  lines.push(`config: maxTokens=${maxTokens} keepMessages=${keepMessages} reasoning=${reasoning} hideTools=${hide} noisePatterns=${noise}`);
  const snap = stored !== null && typeof stored === "object" ? stored : undefined;
  const messages = Array.isArray(snap?.messages) ? snap.messages : undefined;
  if (messages === undefined) {
    lines.push("snapshot: none yet (recall/search will stay silent until the first context event lands)");
    return lines.join("\n");
  }
  const count = typeof snap.count === "number" ? snap.count : messages.length;
  const version = typeof snap.version === "number" ? snap.version : "?";
  const lastID = typeof snap.lastID === "string" && snap.lastID !== "" ? snap.lastID : "(none)";
  let age = "(unknown age)";
  if (typeof snap.writtenAt === "number" && Number.isFinite(snap.writtenAt) && typeof now === "number" && Number.isFinite(now)) {
    const seconds = Math.max(0, Math.floor((now - snap.writtenAt) / 1000));
    age = seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  }
  lines.push(`snapshot: v${version}, ${count} message(s), lastID=${lastID}, written ${age}`);
  return lines.join("\n");
}

/**
 * Classify a storage read for command wiring: one shared outcome for all
 * vcc- commands so read-failure vs empty vs ready never diverge per command.
 * @param stored - raw `ctx.storage.get` value (or the read-failure sentinel).
 * @returns `{ status: "failed" }`, `{ status: "empty" }`, or `{ status: "ready", messages }`.
 */
export function classifySnapshotStore(stored) {
  if (stored !== undefined && stored !== null && stored.__vccReadFailed === true) return { status: "failed" };
  const envelope = stored !== null && typeof stored === "object" ? stored : undefined;
  const messages = envelope?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return { status: "empty" };
  return { status: "ready", messages, stored: envelope };
}

/**
 * Format a `/vcc-recall` agent reply (header + recalled text).
 * @param type - reference type (`seq`, `result`, `checkpoint`).
 * @param id - reference text.
 * @param recalled - `recallSession` output.
 * @returns reply text.
 */
export function formatRecallReply(type, id, recalled) {
  const label = `**/vcc-recall ${type} ${id}** (${recalled.seqs.length} event(s), ${recalled.tokens} tokens${recalled.missing > 0 ? `, ${recalled.missing} missing` : ""}${recalled.truncated ? ", budget-truncated" : ""})`;
  return `${label}\n\n${recalled.text}`;
}

/**
 * Format a `/vcc-search` agent reply (header + search text).
 * @param pattern - raw search pattern.
 * @param found - `searchSession` output.
 * @returns reply text.
 */
export function formatSearchReply(pattern, found) {
  return `**/vcc-search ${pattern}** (${found.totalMatches} matching event(s))\n\n${found.text}`;
}

/**
 * Decide whether a snapshot write is needed (growth guard).
 * @param previous - `{ version, count, lastID }` from the last write (or undefined).
 * @param next - candidate snapshot meta.
 * @returns true when first-write, version-bumped, or grown.
 */
export function snapshotNeedsWrite(previous, next) {
  if (previous === null || previous === undefined) return true;
  if ((previous.version ?? SNAPSHOT_VERSION) !== next.version) return true;
  if (next.count !== previous.count) return true;
  return next.lastID !== previous.lastID;
}

// Tripwire for the O(n²) write-amplification watch: one full-envelope
// rewrite per turn, so warn when a single write exceeds ~1MB. Real
// sessions run ~5KB/message (tool-result JSON + reasoning), far above
// the 160B/message synthetic fillers the original thresholds assumed.
export const MAX_SNAPSHOT_WRITE_BYTES = 1000000;

/**
 * Estimate the serialized size of a snapshot envelope.
 * Unserializable input measures 0 (never trips; the write path
 * warn-and-continues exactly like every other snapshot failure).
 * @param envelope - the snapshot value about to be written.
 * @returns JSON length in chars, or 0 when unserializable.
 */
export function snapshotWriteBytes(envelope) {
  try {
    const text = JSON.stringify(envelope);
    return typeof text === "string" ? text.length : 0;
  } catch {
    return 0;
  }
}

export const WATCH_STATS_VERSION = 1;

/** Storage key prefix; full key is `${WATCH_STATS_KEY_PREFIX}${sessionID}`. */
export const WATCH_STATS_KEY_PREFIX = "vcc-stats/";

/**
 * Fold one snapshot write into the O(n²) watch stats.
 * Pure; malformed previous stats fold from zero (fail-soft, like every
 * snapshot read path). Kept in a separate kv key so the snapshot envelope
 * (and its recall/search/RPC readers) never changes shape.
 * @param previous - stored stats value (or undefined on first write).
 * @param writeBytes - serialized bytes of the write being recorded.
 * @param now - current epoch ms.
 * @returns `{ stats, changed }`: changed when a new max landed or the
 * tripwire fired — the only cases the caller persists.
 */
export function updateWatchStats(previous, writeBytes, now) {
  const prev = previous !== null && typeof previous === "object" ? previous : {};
  const prevMax = typeof prev.maxWriteBytes === "number" && prev.maxWriteBytes > 0 ? prev.maxWriteBytes : 0;
  const prevTrips = typeof prev.tripCount === "number" && prev.tripCount > 0 ? Math.floor(prev.tripCount) : 0;
  const prevTripAt = typeof prev.lastTripwireAt === "number" ? prev.lastTripwireAt : null;
  const prevMaxAt = typeof prev.maxAt === "number" ? prev.maxAt : null;
  const bytes = typeof writeBytes === "number" && writeBytes > 0 ? writeBytes : 0;
  const tripped = bytes > MAX_SNAPSHOT_WRITE_BYTES;
  const newMax = bytes > prevMax;
  return {
    stats: {
      version: WATCH_STATS_VERSION,
      maxWriteBytes: newMax ? bytes : prevMax,
      maxAt: newMax ? now : prevMaxAt,
      tripCount: prevTrips + (tripped ? 1 : 0),
      lastTripwireAt: tripped ? now : prevTripAt,
    },
    changed: newMax || tripped,
  };
}

/**
 * Map one cleaned part to a recall block.
 * @param part - cleaned part.
 * @returns recall block, or null to drop.
 */
function recallBlock(part) {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text ?? "" };
    case "reasoning":
      return { type: "reasoning", text: part.text ?? "" };
    case "tool-call": {
      return { type: "tool-call", name: part.name ?? "unknown", arguments: stringifyToolInput(part.input) };
    }
    case "tool-result": {
      const result = part.result;
      if (result !== null && typeof result === "object" && result.type === "content" && Array.isArray(result.value)) {
        const content = [];
        for (const block of result.value) {
          if (block === null || block === undefined) continue;
          if (block.type === "text") content.push({ type: "text", text: block.text ?? "" });
          else if (block.type === "file") {
            content.push({
              type: "text",
              text: `[file ${block.name ?? block.uri ?? "attachment"}]`,
            });
          } else content.push({ type: String(block.type) });
        }
        return { type: "tool-result", content };
      }
      return { type: "tool-result", content: [{ type: "text", text: projectResultValue(result) }] };
    }
    case "media": {
      return { type: mediaLabel(part) };
    }
    case "compaction":
      return { type: "text", text: part.text ?? "" };
    default:
      return { type: String(part.type) };
  }
}

/**
 * Project one cleaned message to a recall message (`deriveEventMessage`
 * output): `{ role, content }` with recall blocks.
 * @param cleaned - cleaned message.
 * @returns recall message.
 */
export function snapshotMessageToRecall(cleaned) {
  const content = Array.isArray(cleaned?.content) ? cleaned.content : [];
  if (cleaned?.role === "assistant" && content.length === 1 && content[0]?.type === "compaction") {
    return { role: "user", content: [{ type: "text", text: content[0].text ?? "" }] };
  }
  const blocks = [];
  for (const part of content) {
    if (part === null || part === undefined || typeof part.type !== "string") continue;
    const block = recallBlock(part);
    if (block !== null) blocks.push(block);
  }
  return { role: cleaned?.role ?? "user", content: blocks };
}

/**
 * Build the session-shaped event list from cleaned messages. Seq assignment
 * goes through `toNode` directly on the cleaned messages (same filter +
 * 1-based ordinals as checkpoints); payloads stay lossless cleaned raw.
 * @param cleanedMessages - snapshot `messages`.
 * @returns event array with `seq`, `type`, `data`.
 */
export function toSnapshotEvents(cleanedMessages) {
  const list = Array.isArray(cleanedMessages) ? cleanedMessages : [];
  const events = [];
  for (const cleaned of list) {
    if (cleaned === null || cleaned === undefined || !Array.isArray(cleaned.content)) continue;
    const node = toNode(cleaned, events.length + 1);
    if (node === null) continue;
    const isCheckpoint =
      node.message?.role === "user" &&
      node.message?.source?.kind === "compact-checkpoint";
    const type = isCheckpoint
      ? "user/message"
      : cleaned.role === "user"
        ? "user/message"
        : cleaned.role === "tool"
          ? "tool/result"
          : "assistant/message";
    events.push({
      seq: node.seq,
      type,
      data: {
        message: cleaned,
        ...(isCheckpoint ? { source: { kind: "compact-checkpoint" } } : {}),
      },
    });
  }
  return events;
}

/**
 * Make the session-shaped value `recall.mjs` / `search.mjs` read through
 * `session-compat` (`snapshotEvents` + `eventAt` + `deriveEventMessage`).
 * @param cleanedMessages - snapshot `messages`.
 * @returns session-shaped value.
 */
export function makeSnapshotSession(cleanedMessages) {
  const events = toSnapshotEvents(cleanedMessages);
  const frozen = Object.freeze(events.slice());
  const bySeq = new Map(frozen.map((event) => [event.seq, event]));
  return {
    snapshotEvents() {
      return frozen;
    },
    eventAt(seq) {
      return bySeq.get(seq) ?? undefined;
    },
    get events() {
      return frozen;
    },
    deriveEventMessage(event) {
      const cleaned = event?.data?.message;
      if (cleaned === null || cleaned === undefined) return null;
      return snapshotMessageToRecall(cleaned);
    },
  };
}

/**
 * Recall full original content for parsed selections from a snapshot.
 * Thin wrapper over `recallSession` so commands need no DSH imports.
 * @param cleanedMessages - snapshot `messages`.
 * @param selections - parsed inclusive ranges.
 * @param maxRecallTokens - total budget (defaults to engine default).
 * @returns `recallSession` output.
 */
export function recallFromSnapshot(cleanedMessages, selections, maxRecallTokens = DEFAULT_MAX_RECALL_TOKENS) {
  const budget = typeof maxRecallTokens === "number" && Number.isFinite(maxRecallTokens) && maxRecallTokens > 0
    ? maxRecallTokens
    : DEFAULT_MAX_RECALL_TOKENS;
  return recallSession(makeSnapshotSession(cleanedMessages), selections, { maxRecallTokens: budget });
}

/**
 * Search a snapshot for a pattern by delegating to the verbatim
 * `searchSession`: pad a dummy seq-0 entry so the positional
 * `events[seq]` + `seq === seq` contract holds for 1-based seqs.
 * @param cleanedMessages - snapshot `messages`.
 * @param patternSource - raw regex/keyword.
 * @param config - `{ maxSearchHits, maxRecallTokens }` (defaults to engine defaults).
 * @returns `searchSession` output.
 */
export function searchSnapshot(cleanedMessages, patternSource, config = {}) {
  const input = config !== null && typeof config === "object" ? config : {};
  const maxSearchHits = typeof input.maxSearchHits === "number" && Number.isFinite(input.maxSearchHits) && input.maxSearchHits > 0
    ? Math.floor(input.maxSearchHits)
    : DEFAULT_MAX_SEARCH_HITS;
  const maxRecallTokens = typeof input.maxRecallTokens === "number" && Number.isFinite(input.maxRecallTokens) && input.maxRecallTokens > 0
    ? input.maxRecallTokens
    : DEFAULT_MAX_RECALL_TOKENS;
  const inner = makeSnapshotSession(cleanedMessages);
  const live = inner.snapshotEvents();
  const padded = [{ seq: 0, type: "session.created", data: {} }, ...live];
  const paddedSession = {
    snapshotEvents() {
      return padded;
    },
    eventAt(seq) {
      if (seq === 0) return padded[0];
      return inner.eventAt(seq);
    },
    get events() {
      return padded;
    },
    deriveEventMessage(event) {
      if (event?.seq === 0) return null;
      return inner.deriveEventMessage(event);
    },
  };
  const out = searchSession(paddedSession, patternSource, { maxSearchHits, maxRecallTokens });
  // The seq-0 pad satisfies the verbatim positional scan but must never
  // surface: seq 0 is unrecallable (`parseSeqSpec` rejects it), so drop any
  // phantom hit and rebuild the summary around the live hits.
  const hits = out.hits.filter((hit) => hit.seq !== 0);
  const dropped = out.hits.length - hits.length;
  const totalMatches = out.totalMatches - dropped;
  const omitted = Math.max(0, totalMatches - hits.length);
  const lines = [
    `[search "${out.pattern}": ${totalMatches} matching event(s)]`,
    ...hits.map((hit) => hit.text),
    ...(omitted > 0 ? [`[${omitted} more matching event(s) omitted — narrow the pattern or use recall]`] : []),
    ...(out.truncated ? ["[search budget exhausted; some hits were cut]"] : []),
  ];
  if (hits.length > 0) lines.push("[use recall with a (seq N) pointer to restore any hit's full original content]");
  return {
    ...out,
    totalMatches,
    hits,
    omitted,
    text: lines.join("\n\n"),
  };
}
