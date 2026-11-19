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
} from "./engine/recall.mjs";
import {
  DEFAULT_MAX_SEARCH_HITS,
  searchSession,
} from "./engine/search.mjs";

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
  return searchSession(paddedSession, patternSource, { maxSearchHits, maxRecallTokens });
}
