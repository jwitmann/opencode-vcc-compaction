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
 * leaves index 0 empty (a hole the engine skips via its own
 * `event === undefined` guard) so the verbatim `searchSession` contract
 * holds, then delegates — no forked search loop to hand-sync, no phantom
 * hit, no stolen hit-slot or budget. Same hits, honest seqs.
 *
 * The session log is append-only across compactions: `remember` merges
 * each fresh snapshot with the stored prefix (`mergeSnapshotMessages`),
 * then retains newest-wins (`capSnapshotMessages`,
 * `ageSnapshotPayloads`) so the per-turn rewrite stays O(bound) —
 * the 1MB tripwire keeps meaning "exceptional". In-place edits to
 * middle messages are not detected by design.
 *
 * Imports come from `./engine/` (the shipped reference engine).
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
  return {
    version: SNAPSHOT_VERSION,
    messages: cleaned,
    count: cleaned.length,
    lastID: lastMessageID(cleaned),
  };
}

/**
 * Newest message id in a cleaned list (shared by build/retain paths so
 * the meta computation never forks).
 * @param cleaned - cleaned snapshot messages in order.
 * @returns last id, or undefined when no message carries one.
 */
export function lastMessageID(cleaned) {
  if (!Array.isArray(cleaned)) return undefined;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    const id = cleaned[index] !== null && typeof cleaned[index] === "object" ? cleaned[index].id : undefined;
    if (typeof id === "string" && id !== "") return id;
  }
  return undefined;
}

/**
 * Retention bounds. Measured across 31 live snapshots: ~4-9KB/message
 * (median ~5KB, tool-result JSON + reasoning), ~3-4 messages/turn.
 * K=50 newest-wins caps the envelope at ~450KB worst case (~250KB
 * typical) — 2x under the 1MB tripwire — with a ~12-17 turn horizon
 * (>= 1 full compaction interval at every budget scale observed).
 * Full payloads survive only on the newest 20 (bulk lives in recent
 * turns); older tool-result values age out to a marker, keeping the
 * words (tool names, inputs, summary prose) while dropping the bulk.
 */
export const SNAPSHOT_MAX_MESSAGES = 50;

/** Newest messages keeping full tool-result payloads; older ones age out. */
export const SNAPSHOT_FULL_PAYLOAD_MESSAGES = 20;

/**
 * Merge a fresh cleaned snapshot with the previously stored one so the
 * prefix survives compactions (append-mode). Id-union: previous order,
 * then unseen new — one path, no anchor, so post-compaction checkpoints
 * landing before old ids, duplicate ids, and reordered contexts all
 * resolve to the same correct union. Id-less messages always append
 * when ids exist to dedupe with; with no ids on either side the merge
 * is pure duplication, so newest-wins. Pure: never mutates inputs.
 * @param previousMessages - stored cleaned messages (or undefined).
 * @param nextMessages - freshly cleaned messages in order.
 * @returns merged cleaned messages in order (uncapped; caller retains).
 */
export function mergeSnapshotMessages(previousMessages, nextMessages) {
  const prev = Array.isArray(previousMessages) ? previousMessages : [];
  const next = Array.isArray(nextMessages) ? nextMessages : [];
  if (prev.length === 0) return next.slice();
  if (next.length === 0) return prev.slice();
  const seenIDs = new Set();
  let prevIDs = 0;
  for (const message of prev) {
    if (message !== null && typeof message === "object" && typeof message.id === "string" && message.id !== "") {
      seenIDs.add(message.id);
      prevIDs += 1;
    }
  }
  if (prevIDs === 0 && !next.some((message) => message !== null && typeof message === "object" && typeof message.id === "string" && message.id !== "")) {
    return next.slice();
  }
  const merged = [...prev];
  for (const message of next) {
    const id =
      message !== null && typeof message === "object" && typeof message.id === "string" && message.id !== ""
        ? message.id
        : null;
    if (id === null || !seenIDs.has(id)) {
      merged.push(message);
      if (id !== null) seenIDs.add(id);
    }
  }
  return merged;
}

/**
 * Newest-wins message cap (the O(n²) ceiling: per-turn rewrite stays
 * O(bound), so the 1MB tripwire keeps meaning "exceptional").
 * Pure: never mutates the input.
 * @param messages - cleaned messages in order.
 * @param max - cap (defaults to `SNAPSHOT_MAX_MESSAGES`).
 * @returns newest `max` messages (a copy).
 */
export function capSnapshotMessages(messages, max = SNAPSHOT_MAX_MESSAGES) {
  const list = Array.isArray(messages) ? messages : [];
  const limit =
    typeof max === "number" && Number.isFinite(max) && max >= 0 ? Math.floor(max) : SNAPSHOT_MAX_MESSAGES;
  return list.length > limit ? list.slice(list.length - limit) : list.slice();
}

/**
 * Age out tool-result payloads past the newest-message horizon. Older
 * results keep `{ type, id, name }` plus an `aged: true` flag with a null
 * result (renders as empty via `projectResultValue`, matches no search —
 * the words already live in tool names, inputs, and summary prose).
 * Pure: never mutates the input; already-aged parts pass through.
 * @param messages - cleaned messages in order.
 * @param keepFull - newest count keeping full payloads.
 * @returns messages with aged payloads outside the horizon.
 */
export function ageSnapshotPayloads(messages, keepFull = SNAPSHOT_FULL_PAYLOAD_MESSAGES) {
  const list = Array.isArray(messages) ? messages : [];
  const keep =
    typeof keepFull === "number" && Number.isFinite(keepFull) && keepFull >= 0
      ? Math.floor(keepFull)
      : SNAPSHOT_FULL_PAYLOAD_MESSAGES;
  const cutoff = list.length - keep;
  return list.map((message, index) => {
    if (index >= cutoff || message === null || typeof message !== "object" || !Array.isArray(message.content)) {
      return message;
    }
    let changed = false;
    const content = message.content.map((part) => {
      if (
        part !== null &&
        typeof part === "object" &&
        part.type === "tool-result" &&
        part.result !== null &&
        part.result !== undefined &&
        part.aged !== true
      ) {
        changed = true;
        return { ...part, result: null, aged: true };
      }
      return part;
    });
    return changed ? { ...message, content } : message;
  });
}

/**
 * Compose one retained snapshot: clean, merge with the stored prefix,
 * cap, age. The single composition point the wiring calls, so the
 * bound can never be bypassed by a future caller.
 * @param previousMessages - stored cleaned messages (or undefined).
 * @param messages - raw request messages in order.
 * @param bounds - optional `{ maxMessages, fullPayloadMessages }`
 *   (defaults mirror `buildConfig`: 50 / 20).
 * @returns `{ version, messages, count, lastID }`.
 */
export function retainSnapshotMessages(previousMessages, messages, bounds) {
  const scope = bounds !== null && typeof bounds === "object" ? bounds : {};
  const snap = buildSnapshot(messages);
  const merged = mergeSnapshotMessages(previousMessages, snap.messages);
  const aged = ageSnapshotPayloads(capSnapshotMessages(merged, scope.maxMessages), scope.fullPayloadMessages);
  const lastID = lastMessageID(aged);
  return {
    version: SNAPSHOT_VERSION,
    messages: aged,
    count: aged.length,
    ...(lastID === undefined ? {} : { lastID }),
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
 * Per-session compaction switch: `/vcc-compaction on|off` (bare reports
 * state). Stored under `SWITCH_KEY_PREFIX + sessionID` as
 * `{ version, enabled, writtenAt }` — a separate key from the snapshot
 * envelope (mirroring `WATCH_STATS_KEY_PREFIX`), so the switch works
 * before any snapshot exists and never changes the snapshot shape.
 * Absent/empty/garbage reads mean ON (fail open = current behavior).
 */
export const SWITCH_VERSION = 1;

/** Storage key prefix; full key is `${SWITCH_KEY_PREFIX}${sessionID}`. */
export const SWITCH_KEY_PREFIX = "vcc-switch/";

/**
 * Full storage key for a session's compaction switch.
 * @param sessionID - session id.
 * @returns key under `SWITCH_KEY_PREFIX` (never the snapshot key).
 */
export function switchKey(sessionID) {
  return `${SWITCH_KEY_PREFIX}${sessionID}`;
}

/**
 * Parse a `/vcc-compaction` invocation.
 * @param text - raw invocation prompt text.
 * @returns `{ action: "on" | "off" | "query" }`, or `{ error }` with usage text.
 */
export function parseSwitchArgs(text) {
  const raw = String(text ?? "").replace(/^\s*\/vcc-compaction\b/iu, "").trim().toLowerCase();
  if (raw === "") return { action: "query" };
  if (raw === "on") return { action: "on" };
  if (raw === "off") return { action: "off" };
  return { error: "usage: /vcc-compaction [on|off] (bare reports state)" };
}

/**
 * Classify a switch-key storage read for command/hook wiring.
 * @param stored - raw `ctx.storage.get` value (or the read-failure sentinel).
 * @returns `{ status: "failed" }`, or `{ status: "ready", enabled }`
 * (absent/empty/garbage reads resolve enabled=true: the switch defaults
 * ON and every failure path keeps current behavior).
 */
export function classifySwitchStore(stored) {
  if (stored !== undefined && stored !== null && stored.__vccReadFailed === true) return { status: "failed" };
  const envelope = stored !== null && typeof stored === "object" ? stored : undefined;
  if (envelope?.enabled === false) return { status: "ready", enabled: false };
  return { status: "ready", enabled: true };
}

/**
 * Format a `/vcc-status` reply from the stored snapshot and live config.
 * Pure (caller supplies `now`); never throws on malformed snapshots.
 * @param stored - storage value (`{ version, messages, count, lastID, writtenAt }` or undefined).
 * @param config - resolved plugin config from `buildConfig`.
 * @param rev - engine revision string.
 * @param now - current epoch ms (for age computation).
 * @param enabled - per-session switch state (`classifySwitchStore` outcome);
 * omitted keeps the historical shape byte-identical (no compaction line).
 * @returns status text.
 */
export function formatStatusText(stored, config, rev, now, enabled) {
  const lines = [`**/vcc-status** — opencode-vcc-compaction (engine ${rev})`];
  const cfg = config !== null && typeof config === "object" ? config : {};
  const maxTokens = typeof cfg.maxTokens === "number" ? cfg.maxTokens : "?";
  const keepMessages = typeof cfg.keepMessages === "number" ? cfg.keepMessages : "?";
  const reasoning = cfg.includeReasoning === true ? "on" : "off";
  const hide = Array.isArray(cfg.hideTools) ? cfg.hideTools.length : 0;
  const noise = Array.isArray(cfg.noisePatterns) ? cfg.noisePatterns.length : "?";
  lines.push(`config: maxTokens=${maxTokens} keepMessages=${keepMessages} reasoning=${reasoning} hideTools=${hide} noisePatterns=${noise}`);
  if (enabled === true) lines.push("compaction: on (deterministic checkpoint at fire)");
  if (enabled === false) lines.push("compaction: off for this session (hook abstains; host native fallback)");
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
 * `searchSession`: leave index 0 empty (a hole, not a dummy event) so the
 * positional `events[seq]` + `seq === seq` contract holds for 1-based seqs
 * while the hole itself is skipped by the engine's own
 * `event === undefined` guard — it can never match, never consume a
 * maxSearchHits slot, and never burn search budget. A defensive
 * seq-0 filter stays on the output in case the vendored engine ever
 * changes shape.
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
  const aligned = [undefined, ...live];
  const alignedSession = {
    snapshotEvents() {
      return aligned;
    },
    eventAt(seq) {
      if (seq === 0) return undefined;
      return inner.eventAt(seq);
    },
    get events() {
      return aligned;
    },
    deriveEventMessage(event) {
      if (event === undefined || event === null) return null;
      return inner.deriveEventMessage(event);
    },
  };
  const out = searchSession(alignedSession, patternSource, { maxSearchHits, maxRecallTokens });
  // Defense in depth: the index-0 hole can never surface as a hit (the
  // engine skips it before matching), but seq 0 is unrecallable
  // (`parseSeqSpec` rejects it), so drop any phantom hit and rebuild the
  // summary around the live hits.
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
