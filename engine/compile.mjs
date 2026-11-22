/**
 * Region compiler, ported from dsh-compaction-vcc@0.7.4 `src/compiler.js`
 * (MIT: Copyright (c) 2026 TsFreddie, Copyright (c) 2026 Tingfeng) —
 * everything from the noise-stripping section through checkpoint framing.
 * The tokenizer half lives in `./tokenize.mjs` and is imported below,
 * never re-defined.
 *
 * Faithful port with three documented deviations, plus one fork feature
 * (asymmetric tool-result cut) documented below:
 * - Budget primitives (`sanitize`, `countTokens`, `truncateTokens`,
 *   `tailTokens`, `estimateEntryTokens`) are imported from `./tokenize.mjs`
 *   (module-private upstream; exported there so this sibling stage can
 *   import them across the file split).
 * - DSH harness vocabulary is carried verbatim as configurable defaults, not
 *   forked: `DEFAULT_NOISE_PATTERNS`, `DEFAULT_TOOL_KEY_FIELDS`,
 *   `DEFAULT_ARG_TOOLS`, `ELIDABLE_SOURCE_LABELS`, the memory-snapshot /
 *   system-reminder span finders, and `isCheckpointSource` kinds all describe
 *   the DSH host. The OpenCode mapping lives in config (`noisePatterns`,
 *   `toolKeyFields`, `toolArgTools`, `hideTools`, `elideSourceKinds`) and in
 *   the node-projection adapter (hook `Message` + `SessionMessage.ID` ->
 *   `{ seq, message }`), which is a later stage per `archive/plans/vcc-compiler.md`.
 * - `elideCheckpointInjectedBodies` is retained verbatim but stays inert
 *   unless `config.elideCheckpointInjectedBodies === true`; the OpenCode
 *   consumer leaves it off (REUSE.md rejects it — the preamble here is
 *   per-request transient, never persisted history).
 * - Fork feature (not upstream): asymmetric tool-result cut. The `tool`
 *   branch reads `message.isError` (threaded by the OpenCode adapter from
 *   structured `result.type`, never text-derived), gives failures the
 *   larger `toolErrorExcerptTokens` budget, collapses huge successes to a
 *   recall pointer past `toolResultPointerTokens` (off by default), and
 *   exempts error rows from both cap-elision passes (fail open, counted
 *   in `stats.keptErrorWhole`). Defaults are byte-identical to upstream.
 *
 * Note on style: this file keeps upstream's semicolons verbatim for
 * line-for-line comparability with the MIT source. This coincides with
 * the repo's own `.mjs` style (`engine/selftest.mjs` uses
 * semicolons), so there is no style conflict in practice.
 *
 * Everything below is deterministic and offline: same nodes + config always
 * yield byte-identical entries, with no model call and no dependencies.
 */
import {
  countTokens,
  estimateEntryTokens,
  sanitize,
  tailTokens,
  truncateTokens,
} from "./tokenize.mjs";

// ── noise stripping (VCC `_BRIEF_STRIP_RE` family) ─────────────────────────

const NOISE_UNWRAP_RE = /<\/?(?:command-name|command-args)>/g;

/**
 * The VCC brief-mode noise XML patterns, adapted to harness markup. Applied
 * with the `s` flag; the replacement set is configurable via
 * `InstantCompactionConfig.noisePatterns`.
 */
export const DEFAULT_NOISE_PATTERNS = [
  "<ide_opened_file>.*?</ide_opened_file>",
  "<ide_selection>.*?</ide_selection>",
  "<system-reminder>.*?</system-reminder>",
  "<command-message>.*?</command-message>",
  "<task-notification>.*?</task-notification>"
];

/** Compile untrusted noise-pattern sources, throwing on invalid regex. */
export function compileNoisePatterns(sources) {
  return sources.map((source, index) => {
    try {
      return new RegExp(source, "s");
    } catch (error) {
      throw new Error(`noisePatterns[${index}] (${JSON.stringify(source)}) is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

/**
 * Strip configured noise XML blocks from user text and unwrap command-name /
 * command-args tags (VCC `_strip_noise_xml` + `_BRIEF_UNWRAP_RE`).
 * @param text - user text.
 * @param patterns - compiled noise regexes.
 * @returns the stripped text, trimmed.
 */
export function stripNoiseXml(text, patterns) {
  let out = text;
  for (const pattern of patterns) out = out.replace(pattern, "");
  out = out.replace(NOISE_UNWRAP_RE, "");
  return out.trim();
}

// ── tool-call one-liner (VCC `_tool_summary`) ──────────────────────────────

/** VCC's `_TOOL_SUMMARY_FIELDS`, extended for the DSH tool catalog. */
export const DEFAULT_TOOL_KEY_FIELDS = Object.freeze({
  read: "file_path",
  edit: "file_path",
  write: "file_path",
  glob: "pattern",
  grep: "pattern",
  bash: "command",
  web_search: "query",
  skill: "name",
  ralph: "objective",
  subagent: "description",
  subagent_fork: "description",
  create_goal: "objective",
  update_goal: "objective",
  workflow: "name",
  interrupt_agent: "agent_id",
  job_kill: "job_id",
  job_output: "job_id",
  send_message: "message"
});

/**
 * Tools whose key argument is kept in the one-liner. Everything else renders
 * name-only (`* tool (seq N)`) — bookkeeping tools carry no semantic payload
 * worth the tokens (VCC's brief mode keeps `Read`/`Edit`/… args and drops the
 * rest; `_BRIEF_HIDE_TOOLS` goes further and hides TodoWrite/ToolSearch
 * entirely, which `hideTools` config covers here).
 */
export const DEFAULT_ARG_TOOLS = Object.freeze([
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "bash",
  "shell",
  "web_search",
  "skill",
  "subagent",
  "subagent_fork",
  "ralph",
  "workflow"
]);

/**
 * First-line projection for a tool-call one-liner: multiline arguments
 * collapse to the first physical line plus a `[+ N lines]` marker, so
 * scripted commands (bash heredocs, multi-line pipelines) stay one compact
 * line instead of echoing the whole payload.
 * @param value - the key-argument string.
 * @returns the display value.
 */
export function oneLineArg(value) {
  const lines = value.split(/\r?\n/u);
  if (lines.length === 1) return value;
  const first = lines[0] !== "" || lines.every((line) => line.trim() === "")
    ? lines[0]
    : lines.find((line) => line.trim() !== "");
  return `${first} [+ ${lines.length - 1} lines]`;
}

/**
 * Pick the key argument for a tool-call one-liner: the tool-specific field
 * first, then the first string-valued argument, else nothing.
 * @param name - tool name.
 * @param input - parsed arguments object (or null when unparseable).
 * @param keyFields - merged tool-name → preferred-field map.
 * @returns the display value, or undefined.
 */
export function pickToolKeyArg(name, input, keyFields) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const preferred = keyFields[name];
  if (preferred !== undefined) {
    const value = input[preferred];
    if (typeof value === "string" && value.length > 0) return value;
  }
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Safely parse a tool-call's raw JSON arguments string.
 * @param arguments_ - raw JSON as produced by the model.
 * @returns the parsed value, or null when it is not valid JSON.
 */
export function parseToolArguments(arguments_) {
  try {
    return JSON.parse(arguments_);
  } catch {
    return null;
  }
}

// ── content projection helpers ─────────────────────────────────────────────

/**
 * Project nested tool-result blocks into one plain-text string: text blocks
 * are joined, images and documents render as VCC-style labels.
 * @param blocks - nested result content.
 * @returns projected text.
 */
export function projectToolResultText(blocks) {
  const parts = [];
  // ⚠️ 2026-11-07 — tolerate a missing/non-array projection input and null
  // blocks inside it. Both used to throw (`block.type` on null), and this helper
  // sits on the tool-result, memory-recall and search paths alike.
  if (!Array.isArray(blocks)) return "";
  for (const block of blocks) {
    if (block === null || block === undefined) continue;
    if (block.type === "text") {
      const text = sanitize(block.text ?? "");
      if (text.length > 0) parts.push(text);
    } else if (block.type === "image") parts.push("[image]");
    else if (block.type === "document") parts.push("[document]");
    else parts.push(`[${String(block.type)}]`);
  }
  return parts.join("\n");
}

/** Whether a message source identifies a landed compaction checkpoint node. */
export function isCheckpointSource(source) {
  if (source === undefined || source === null) return false;
  // Host 0.2.x builds the marker with `compactCheckpointSource()`, which yields
  // `{ kind: "compact-checkpoint", compactionId, sourceCommandId? }`. The legacy
  // `{ kind: "plugin", plugin: "compact" }` shape from earlier hosts is still
  // accepted so checkpoints written by an older host stay recallable.
  if (source.kind === "compact-checkpoint") return true;
  return source.kind === "plugin" && source.plugin === "compact";
}

/**
 * Whether a message source is one of the harness-injected instruction blocks
 * the caller asked to elide (see `elideSourceKinds`). Matching is on the
 * structured `source.kind` field the harness records, never on message text:
 * a user quoting "Instructions from:" must not be mistaken for the real thing.
 *
 * The default (`undefined`/empty) matches nothing, so the open-source default
 * behavior is byte-identical to before this option existed.
 * @param source - message source descriptor, possibly absent.
 * @param kinds - configured exact `source.kind` values to elide.
 * @returns true when this node should collapse to a recall pointer.
 */
export function isElidableSource(source, kinds) {
  if (kinds === undefined || kinds.length === 0) return false;
  const kind = source?.kind;
  return typeof kind === "string" && kinds.includes(kind);
}

/**
 * Display labels for elidable instruction sources. Anything not listed falls
 * back to its raw `source.kind`, so a new host source still gets a readable
 * pointer without a code change.
 */
const ELIDABLE_SOURCE_LABELS = Object.freeze({
  "dsh-mnemon": "记忆快照",
  "agent-instructions": "规则与冷库索引",
  "skill-catalog": "技能清单",
  "runtime-context": "运行时上下文",
  "time-context": "时间上下文"
});

/**
 * Markers that open a hot-memory snapshot as our memory plugin renders it.
 * `[MNEMON]` is the routing hint, `MNEMON RUNTIME MEMORY SNAPSHOT` the payload.
 */
const MEMORY_SNAPSHOT_MARKERS = Object.freeze(["MNEMON RUNTIME MEMORY SNAPSHOT", "[MNEMON]"]);
/** Closing tag of one memory file block inside a snapshot. */
const MEMORY_FILE_CLOSE = "</runtime-memory-file>";
/**
 * Text that may separate two consecutive memory file blocks of ONE snapshot
 * (`USER.md` then `MEMORY.md`), so the two are treated as a single span.
 */
const MEMORY_BLOCK_JOINER = /^\s*(?:MEMORY\.md \(working reference\)|USER\.md \(user profile\)|<runtime-memory-file )/;
/**
 * One role header line of this compiler's own checkpoint format. Memory snapshots
 * never contain one, so finding it between a file block's opening and its close
 * means the close belongs to a LATER block and the span must stop before this.
 * Guards the truncation case: a block cut mid-way loses its closing tag, and
 * without this the span would swallow the conversation that follows.
 */
const MEMORY_ROLE_HEAD = /\n\[(?:user|assistant|tool)\]\s*\n/;

/**
 * Marker text the host puts inside a REAL rules/index wrapper. Prose that only
 * mentions `<system-reminder>` as a string must not qualify, so a candidate
 * span has to prove itself by carrying one of these phrases early on.
 */
const SYSTEM_REMINDER_BODY_MARKERS = Object.freeze([
  "The following workspace instructions may be relevant",
  "Instructions from:"
]);
/** How far into a candidate wrapper the proof phrase must appear. */
const SYSTEM_REMINDER_PROOF_WINDOW = 600;
/** How close a memory marker must sit to the first file block to count. */
const MEMORY_MARKER_WINDOW = 800;

/**
 * Locate injected memory snapshots embedded in a PRIOR checkpoint body.
 *
 * A snapshot is a run of consecutive `<runtime-memory-file …>…</…>` blocks.
 * The span starts at the nearest preceding snapshot marker so the routing hint
 * and the "Entry annotations default…" preamble go with it. The marker must sit
 * close to the first file block, so prose that merely quotes the marker text
 * (e.g. a discussion about this very feature) is not mistaken for a snapshot.
 * @param text - prior checkpoint body.
 * @returns `[start, end)` character spans, left to right.
 */
function findMemorySnapshotSpans(text) {
  const spans = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const markerAt = MEMORY_SNAPSHOT_MARKERS
      .map((marker) => text.indexOf(marker, searchFrom))
      .filter((index) => index !== -1)
      .reduce((lowest, index) => (lowest === undefined || index < lowest ? index : lowest), undefined);
    if (markerAt === undefined) break;
    const firstFile = text.indexOf("<runtime-memory-file ", markerAt);
    if (firstFile === -1) break;
    if (firstFile - markerAt > MEMORY_MARKER_WINDOW) {
      // Just prose quoting the marker — skip past it and keep looking.
      searchFrom = markerAt + 1;
      continue;
    }
    let end;
    let cursor = firstFile;
    for (;;) {
      const close = text.indexOf(MEMORY_FILE_CLOSE, cursor);
      if (close === -1) break;
      // A memory block whose closing tag was truncated away has no close of its
      // own, so the search below would run on to the NEXT block's close and
      // swallow every real turn in between. Role headers are this compiler's own
      // output and never appear inside a memory snapshot, so a role header before
      // the close proves the span has left the block: stop there and keep the
      // dialogue. Erring toward eliding less is safe; eliding a turn is not.
      const roleHead = MEMORY_ROLE_HEAD.exec(text.slice(cursor, close));
      if (roleHead !== null) {
        end = cursor + roleHead.index;
        break;
      }
      const after = close + MEMORY_FILE_CLOSE.length;
      end = after;
      cursor = after;
      if (!MEMORY_BLOCK_JOINER.test(text.slice(after, after + 240))) break;
    }
    if (end === undefined) break;
    spans.push([markerAt, end]);
    searchFrom = end;
  }
  return spans;
}

/**
 * Locate `<system-reminder>…</system-reminder>` wrappers that really frame
 * workspace rules, the cold-store index or runtime context.
 *
 * The wrapper must open at a line start, be followed by the block body marker
 * within a short window, and close before the body repeats — the host emits one
 * wrapper per injection, never nested. A sentence that merely mentions the tag
 * name fails all three checks, which is what keeps live prose intact.
 * @param text - prior checkpoint body.
 * @returns `[start, end)` character spans, left to right.
 */
function findSystemReminderSpans(text) {
  const spans = [];
  const pattern = /(?:^|\n)<system-reminder>\n/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const open = text.indexOf("<system-reminder>", match.index);
    const head = text.slice(open, open + SYSTEM_REMINDER_PROOF_WINDOW);
    if (!SYSTEM_REMINDER_BODY_MARKERS.some((marker) => head.includes(marker))) continue;
    const close = text.indexOf("</system-reminder>", open);
    if (close === -1) continue;
    spans.push([open, close + "</system-reminder>".length]);
  }
  return spans;
}

/**
 * Collapse harness-injected bodies embedded in a PRIOR checkpoint to one-line
 * pointers.
 *
 * Why this exists: those bodies are re-sent in full after every compaction, so
 * any copy kept inside a checkpoint body is a duplicate — the checkpoint grows
 * by one snapshot per compaction even though nothing new was said. The originals
 * stay in the append-only session log, so `recall` still restores them verbatim.
 *
 * Only checkpoint prose is touched; live conversation text is never scanned.
 * @param text - prior checkpoint body.
 * @returns the rewritten body plus how many spans and characters were removed.
 */
export function elideCheckpointInjectedBodies(text) {
  const spans = [...findMemorySnapshotSpans(text), ...findSystemReminderSpans(text)]
    .sort((left, right) => left[0] - right[0]);
  if (spans.length === 0) return { text, spans: 0, chars: 0 };
  let out = "";
  let cursor = 0;
  let chars = 0;
  let removed = 0;
  for (const [start, end] of spans) {
    // Overlapping spans would otherwise duplicate text; keep the outer one.
    if (start < cursor) continue;
    out += text.slice(cursor, start);
    const length = end - start;
    chars += length;
    removed += 1;
    out += `[注入内容已压缩为指针（原文 ${length} 字符）— 压缩后会重新注入，原文可用 recall 调回]`;
    cursor = end;
  }
  out += text.slice(cursor);
  return { text: out, spans: removed, chars };
}

/**
 * One-line pointer standing in for an elided instruction block. Carries the
 * seq so the agent can `recall` the original, plus what it was and how big it
 * was — a bare `(seq N)` would read as content loss rather than a substitution.
 * @param label - human name of the block ("记忆快照" / "规则与索引").
 * @param seq - source sequence of the elided message.
 * @param length - original character count.
 * @returns the marker line.
 */
function elidedSourceMarker(label, seq, length) {
  return `[${label} 已压缩为指针（${seqRef(seq)}，原文 ${length} 字符）— 原文可用 recall 调回，且下一次压缩后会重新注入]`;
}

/**
 * Head/tail excerpt of a tool result under one shared token budget. The tail
 * is anchored to the end of the text at character granularity, so a result
 * whose tail matters more than its head (file listings, logs) keeps its end.
 * @param text - projected result text.
 * @param budget - combined non-whitespace token budget for head + tail.
 * @param ref - provenance for the elision marker.
 * @returns the excerpt, or the full text when it already fits.
 */
export function excerptToolResult(text, budget, ref) {
  const overBudget = countTokens(text) > budget || text.length > budget * 4;
  if (budget <= 0 || !overBudget) return text;
  const half = Math.floor(budget / 2);
  const headLimit = Math.max(8, half);
  const tailLimit = Math.max(8, budget - headLimit);
  const head = truncateTokens(text, headLimit, ref);
  const tail = tailTokens(text, tailLimit, ref);
  return `${head.text}\n...(elided from ${ref})\n${tail.text}`;
}

// ── the region compiler ────────────────────────────────────────────────────

const CHECKPOINT_PREAMBLE = "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.";
const CHECKPOINT_OPEN_TAG = "<compacted-checkpoint>";
const CHECKPOINT_CLOSE_TAG = "</compacted-checkpoint>";

/**
 * Model-facing guide framed into the head of every checkpoint: tells the
 * agent how to recover content the compiler elided or truncated, using the
 * two recall tools that read the append-only durable log.
 */
export const RECALL_GUIDE = "RECALL: append-only log — nothing is lost. `recall` restores original content: type \"seq\", id \"3-7\"; \"result\", id \"3\"; \"checkpoint\", id \"1\" (`[checkpoint N]` = dropped). `search` finds by keyword.";

/** Per-node reference marker: the durable seq is the lossless pointer. */
function seqRef(seq) {
  return `seq ${seq}`;
}

/**
 * Build marker for this compiler revision. Bumped whenever the compiled
 * output format changes, so debug logs can prove which code version ran.
 */
export const COMPILER_REV = "vcc-compiler-debug-2";

/**
 * Emit one debug line through the configured sink (and stderr). The sink is
 * installed by the engine (`config.debugSink`) when `debug` is enabled; the
 * compiler itself stays dependency-free.
 * @param config - resolved compiler configuration.
 * @param tag - short component tag for the line.
 * @param line - the diagnostic text.
 */
function debugLog(config, tag, line) {
  if (config.debug !== true) return;
  const text = `[dsh-compaction-vcc] ${tag}: ${line}`;
  try {
    if (typeof config.debugSink === "function") config.debugSink(text);
  } catch {
    /* a failing debug sink must never break a compaction */
  }
  try {
    console.error(text);
  } catch {
    /* stderr may be unavailable in embedded contexts */
  }
}

/**
 * Compile one ordered region into compact entries.
 * @param nodes - ordered `{ seq, message }` projections of the shadowed
 *   surface nodes; `message` may be null (non-projecting node).
 * @param config - resolved compiler-relevant configuration (see index.js).
 * @param budgets - optional per-block budgets; defaults to the config values
 *   (the budget-cap loop passes scaled budgets on retry).
 * @returns `{ entries, stats }` where each entry is one line-group string.
 */
export function compileNodes(nodes, config, budgets) {
  const effective = budgets ?? {
    textTokens: config.textTokens,
    userTextTokens: config.userTextTokens,
    toolCallTokens: config.toolCallTokens,
    toolResultExcerptTokens: config.toolResultExcerptTokens,
    // Split-budget fallbacks for direct engine callers (the adapter always
    // resolves both): errors share the success budget, pointers stay off.
    toolErrorExcerptTokens: config.toolErrorExcerptTokens ?? config.toolResultExcerptTokens,
    toolResultPointerTokens: config.toolResultPointerTokens ?? Infinity
  };
  const keyFields = { ...DEFAULT_TOOL_KEY_FIELDS, ...(config.toolKeyFields ?? {}) };
  const patterns = config.noisePatterns ?? [];
  // Empty lists mean "unset": the cordis config pipeline injects `[]` for
  // absent array keys, so fall back to the defaults instead of rendering
  // every tool call name-only.
  const argTools = config.toolArgTools?.length > 0 ? config.toolArgTools : DEFAULT_ARG_TOOLS;
  const hiddenTools = new Set(config.hideTools ?? []);
  debugLog(config, "compile", `rev=${COMPILER_REV} nodes=${nodes.length} argTools=[${argTools.join(",")}] hideTools=[${[...hiddenTools].join(",")}] budgets=${JSON.stringify(effective)}`);
  const entries = [];
  const stats = {
    nodes: nodes.length,
    entries: 0,
    toolCalls: 0,
    toolResults: 0,
    images: 0,
    documents: 0,
    reasoningElided: 0,
    noiseElided: 0,
    elidedSourceRows: 0,
    elidedSourceChars: 0,
    elidedCheckpointSpans: 0,
    elidedCheckpointChars: 0,
    checkpoints: 0,
    tokens: 0,
    elidedToolRows: 0,
    elidedRows: 0,
    // Fail-open count: error-diagnosis rows the cap passes refused to drop.
    keptErrorWhole: 0
  };
  // Pre-pass over the ordered nodes: map each tool-call id to the seq of its
  // result node, so every call one-liner can carry a VCC-style result pointer
  // (`(seq N -> result M)`) even though results no longer occupy entries.
  //
  // ⚠️ 2026-11-06 (this fork) — host 0.2.2 compatibility fix.
  // Up to host ~0.1.x a derived tool-result message exposed `toolCallId` on its
  // FIRST CONTENT BLOCK (`message.content[0].toolCallId`), and that is the only
  // shape this pre-pass used to look at. Host 0.2.2 derives a tool message the
  // way the model APIs do: `role: "tool"` with `toolCallId` on the MESSAGE
  // (`message.toolCallId`), while `content[0]` is a plain text block. The old
  // check therefore never matched, `resultSeqByCallId` stayed empty, and every
  // `* read "a.js" (seq 2)` one-liner silently lost its `-> result 3` pointer —
  // the hook `recall(type:"result")` relies on. Nothing threw; the checkpoint
  // just quietly stopped being lossless. Read the message-level field first and
  // keep the legacy `content[0]` shape as a fallback so one build serves both
  // host generations.
  const resultSeqByCallId = new Map();
  for (const node of nodes) {
    const message = node.message;
    if (message === null || message === undefined) continue;
    const first = message.content?.[0];
    // ⚠️ 2026-11-07 — `first !== undefined` misses null, which threw on
    // `first.type`. Guard the null block explicitly.
    const toolResultBlock = first !== undefined && first !== null && first.type === "tool-result" ? first : undefined;
    const callId = typeof message.toolCallId === "string"
      ? message.toolCallId
      : typeof toolResultBlock?.toolCallId === "string"
        ? toolResultBlock.toolCallId
        : undefined;
    if (callId !== undefined) resultSeqByCallId.set(callId, node.seq);
  }
  let lastRole;
  let open = false;

  /**
   * Append one compiled entry carrying a deletion-priority kind. Kinds order
   * the cap-elision passes in compileRegion: `result`/`tool`/`media`/`note`
   * rows are dropped before `text`/`reasoning`/`checkpoint` rows, so when a
   * checkpoint must shrink, the conversation's words survive its logs.
   * @param seq - durable seq the entry derives from.
   * @param text - rendered entry text.
   * @param kind - entry kind (see the kind list above).
   * @param flags - optional extra entry fields (e.g. `{ error: true }` for
   *   failure-diagnosis rows the cap passes must not drop).
   */
  const pushEntry = (seq, text, kind, flags) => {
    entries.push({ seq, text, kind, ...flags });
    stats.entries += 1;
    stats.tokens += estimateEntryTokens(text);
  };
  const roleHeader = (role, seq) => {
    if (!open || lastRole !== role) {
      open = true;
      lastRole = role;
      return `[${role}]\n`;
    }
    return "";
  };

  for (const node of nodes) {
    const message = node.message;
    // ⚠️ 2026-11-07 — `content` must be an iterable array here. A null/absent
    // `content` used to fall through to `message.content[0]` below and throw
    // `Cannot read properties of null (reading '0')`, which aborted the WHOLE
    // compile: one malformed node cost the entire compaction, silently (the
    // host's pre-step handler swallows the error as a warning). Skip the node
    // instead so the rest of the region still compiles.
    if (message === null || message === undefined) continue;
    if (!Array.isArray(message.content)) continue;
    if (message.role === "assistant") {
      let header = "";
      for (const block of message.content) {
        // ⚠️ 2026-11-07 — a null/undefined block in the array used to throw on
        // `block.type` and abort the whole compile. Skip it.
        if (block === null || block === undefined) continue;
        if (block.type === "text") {
          const text = sanitize(block.text ?? "");
          if (text.trim().length === 0) continue;
          header = roleHeader("assistant", node.seq);
          const kept = truncateTokens(text, effective.textTokens, seqRef(node.seq));
          pushEntry(node.seq, header + kept.text, "text");
          continue;
        }
        if (block.type === "reasoning") {
          if (config.includeReasoning !== true) {
            stats.reasoningElided += 1;
            continue;
          }
          const text = sanitize(block.text ?? "");
          if (text.trim().length === 0) continue;
          header = roleHeader("assistant", node.seq);
          const kept = truncateTokens(text, effective.textTokens, seqRef(node.seq));
          pushEntry(node.seq, header + kept.text, "reasoning");
          continue;
        }
        if (block.type === "tool-call") {
          const name = block.name ?? "unknown";
          stats.toolCalls += 1;
          if (hiddenTools.has(name)) {
            debugLog(config, "tool", `seq=${node.seq} name=${name} HIDDEN (hideTools)`);
            continue;
          }
          header = roleHeader("assistant", node.seq);
          // One line, always: key argument only for whitelisted tools, and a
          // VCC-style pointer to the result node (`* read "a.js" (seq 2 ->
          // result 3)`) so the dropped result stays one recall away.
          let oneLine;
          let diag;
          if (argTools.includes(name)) {
            const parsed = parseToolArguments(block.arguments);
            const arg = pickToolKeyArg(name, parsed, keyFields);
            oneLine = arg === undefined ? `* ${name}` : `* ${name} "${oneLineArg(arg)}"`;
            diag = `whitelist=yes argsType=${typeof block.arguments} argsLen=${block.arguments === null || block.arguments === undefined ? 0 : String(block.arguments).length} argsHead=${JSON.stringify(String(block.arguments).slice(0, 60))} parse=${parsed === null ? "FAIL" : "ok"} key=${keyFields[name] ?? "(fallback)"} arg=${arg === undefined ? "(none)" : JSON.stringify(String(arg).slice(0, 60))}`;
          } else {
            oneLine = `* ${name}`;
            diag = `whitelist=no argsType=${typeof block.arguments} argsLen=${block.arguments === null || block.arguments === undefined ? 0 : String(block.arguments).length} argsHead=${JSON.stringify(String(block.arguments).slice(0, 60))}`;
          }
          const resultSeq = resultSeqByCallId.get(block.id);
          const ref = resultSeq === undefined ? seqRef(node.seq) : `${seqRef(node.seq)} -> result ${resultSeq}`;
          const kept = truncateTokens(oneLine, effective.toolCallTokens, seqRef(node.seq));
          debugLog(config, "tool", `seq=${node.seq} name=${name} ${diag} line=${JSON.stringify(oneLine.slice(0, 80))} truncated=${kept.truncated} ref=${ref}`);
          pushEntry(node.seq, header + `${kept.text} (${ref})`, "tool");
          continue;
        }
        if (block.type === "image") {
          stats.images += 1;
          header = roleHeader("assistant", node.seq);
          pushEntry(node.seq, header + `[image] (${seqRef(node.seq)})`, "media");
          continue;
        }
        if (block.type === "document") {
          stats.documents += 1;
          header = roleHeader("assistant", node.seq);
          pushEntry(node.seq, header + `[document] (${seqRef(node.seq)})`, "media");
          continue;
        }
        /* unknown merge-extensible block types render as labels */
        {
          header = roleHeader("assistant", node.seq);
          pushEntry(node.seq, header + `[${String(block.type)}] (${seqRef(node.seq)})`, "media");

        }
      }
      /* reasoning-only and empty assistant messages produce no entry */
      continue;
    }
    // ⚠️ 2026-11-07 — host 0.2.x derives a tool result as `role: "tool"` with
    // `toolCallId` on the MESSAGE and a plain text block as `content[0]`. The
    // loop used to handle only `assistant` and `user`, so every real tool result
    // fell through and produced no entry: `stats.toolResults` stayed at 0, the
    // `toolResultExcerptTokens` budget was inert, and the tool output never
    // appeared in the checkpoint at all. Only the `-> result N` pointer survived
    // (that map is built by the separate pre-pass above), so `recall` could still
    // fetch the original — but the compiled view was misdescribed as "lossless"
    // while silently dropping this whole class of content.
    if (message.role === "tool") {
      stats.toolResults += 1;
      const body = projectToolResultText(message.content);
      if (body.length > 0) {
        const header = roleHeader("tool", node.seq);
        // Asymmetric cut (docs/research/asymmetric-cut-design.md): failures
        // keep the larger error budget and are never pointer-collapsed —
        // successes are one `recall` away, failure diagnostics are not.
        // Excerpt to the configured budget otherwise: tool output is the
        // bulk of a long session, and the full text stays one
        // `recall(type:"result")` away via the call line's `-> result N`
        // pointer.
        const isError = message.isError === true;
        const pointerAt = effective.toolResultPointerTokens ?? Infinity;
        // Pointer rule, token count AND char density (mirrors the length
        // guard in excerptToolResult): a single-token blob (base64,
        // minified file) must not slip past a token-count threshold.
        if (!isError && Number.isFinite(pointerAt) && (countTokens(body) > pointerAt || body.length > pointerAt * 4)) {
          pushEntry(node.seq, `${header}[success output elided to pointer (result ${node.seq})]`, "result");
        } else {
          const budget = isError
            ? (effective.toolErrorExcerptTokens ?? effective.toolResultExcerptTokens)
            : effective.toolResultExcerptTokens;
          const kept = excerptToolResult(body, budget, seqRef(node.seq));
          pushEntry(node.seq, header + kept, "result", isError ? { error: true } : undefined);
        }
      }
      continue;
    }
    if (message.role === "user") {
      const first = message.content[0];
      if (first !== undefined && first !== null && first.type === "tool-result") {
        // Tool results never occupy an entry: the content is either absorbed
        // into the following assistant text or one recall away via the call
        // line's `-> result N` pointer (VCC drops results from brief mode too).
        stats.toolResults += 1;
        continue;
      }
      if (isCheckpointSource(message.source)) {
        stats.checkpoints += 1;
        let text = projectToolResultText(message.content);
        if (text.length > 0 && config.elideCheckpointInjectedBodies === true) {
          // A prior checkpoint body still carries every memory snapshot and
          // rules block that was live when it was compiled. Those are re-sent
          // in full after this compaction, so keeping them here is a duplicate.
          // Opt-in (default off) because it rewrites previously compiled prose.
          const collapsed = elideCheckpointInjectedBodies(text);
          if (collapsed.spans > 0) {
            text = collapsed.text;
            stats.elidedCheckpointSpans += collapsed.spans;
            stats.elidedCheckpointChars += collapsed.chars;
          }
        }
        if (text.length > 0) {
          // The checkpoint node is a user/message in the durable protocol
          // (surface replacement only allows message nodes), but it is
          // harness-generated framing — display it as [system].
          const header = roleHeader("system", node.seq);
          pushEntry(node.seq, header + text, "checkpoint");
        }
        continue;
      }
      if (isElidableSource(message.source, config.elideSourceKinds)) {
        // Harness-injected instruction blocks (hot memory, workspace rules,
        // skill catalog…) are re-injected in full after every compaction, so
        // keeping their body here duplicates them: one copy in the checkpoint,
        // one copy re-injected, every time. Collapse to a recall pointer.
        // `elideSourceKinds` is empty by default, so stock behavior is
        // unchanged; we enable it because our memory plugin re-injects.
        const text = projectToolResultText(message.content);
        if (text.length === 0) continue;
        const label = ELIDABLE_SOURCE_LABELS[message.source.kind] ?? message.source.kind;
        stats.elidedSourceRows += 1;
        stats.elidedSourceChars += text.length;
        pushEntry(node.seq, `${roleHeader("user", node.seq)}* ${elidedSourceMarker(label, node.seq, text.length)}`, "note");
        continue;
      }
      let surviving = 0;
      let header = "";
      for (const block of message.content) {
        // ⚠️ 2026-11-07 — a null/undefined block in the array used to throw on
        // `block.type` and abort the whole compile. Skip it.
        if (block === null || block === undefined) continue;
        if (block.type === "text") {
          let text = sanitize(block.text ?? "");
          if (config.stripNoiseXml !== false) text = stripNoiseXml(text, patterns);
          if (text.length === 0) continue;
          surviving += 1;
          header = roleHeader("user", node.seq);
          const kept = truncateTokens(text, effective.userTextTokens, seqRef(node.seq));
          pushEntry(node.seq, header + kept.text, "text");
        } else if (block.type === "image") {
          stats.images += 1;
          surviving += 1;
          header = roleHeader("user", node.seq);
          pushEntry(node.seq, header + `[image] (${seqRef(node.seq)})`, "media");
        } else if (block.type === "document") {
          stats.documents += 1;
          surviving += 1;
          header = roleHeader("user", node.seq);
          pushEntry(node.seq, header + `[document] (${seqRef(node.seq)})`, "media");
        } else {
          const text = sanitize(block.text ?? "");
          if (text.length === 0) continue;
          surviving += 1;
          header = roleHeader("user", node.seq);
          const kept = truncateTokens(text, effective.userTextTokens, seqRef(node.seq));
          pushEntry(node.seq, header + kept.text, "text");
        }
      }
      if (surviving === 0) {
        stats.noiseElided += 1;
        pushEntry(node.seq, `${roleHeader("user", node.seq)}* [user message elided: noise-only] (${seqRef(node.seq)})`, "note");
      }
    }
  }
  return { entries, stats };
}

/**
 * Per-budget elision floors: conversation text keeps a meaningful minimum
 * even when the total cap forces heavy rescaling, while tool one-liners and
 * result excerpts may collapse to near-nothing first.
 */
const BUDGET_FLOORS = Object.freeze({
  textTokens: 32,
  userTextTokens: 32,
  toolCallTokens: 8,
  toolResultExcerptTokens: 8,
  toolErrorExcerptTokens: 8
});

/** Entry kinds dropped by the first (low-value) elision pass. */
const LOW_VALUE_KINDS = new Set(["result", "tool", "media", "note"]);

/**
 * Scale ONLY the conversation-text budgets toward a total cap, never below
 * the per-key floor. Tool-call rows stay one-liners at their configured
 * budget: conversation shrinks first, tool rows are sacrificed whole by the
 * elision pass, so tool calls can never squeeze the dialogue out.
 * @param budgets - budget map to scale.
 * @param factor - uniform scale factor for text budgets.
 * @returns the scaled budget map (tool budgets untouched).
 */
function scaleBudgets(budgets, factor) {
  const scaled = { ...budgets };
  for (const key of ["textTokens", "userTextTokens"]) {
    scaled[key] = Math.max(BUDGET_FLOORS[key] ?? 8, Math.floor(budgets[key] * factor));
  }
  return scaled;
}

/** Render the provenance range of one dropped-entry list. */
function seqRangeOf(dropped) {
  const first = dropped[0].seq;
  const last = dropped[dropped.length - 1].seq;
  return first === last ? `seq ${first}` : `seqs ${first}-${last}`;
}

/**
 * Compile a region to completion under the total checkpoint cap: budgets are
 * rescaled toward `config.maxTokens` up to a fixed number of attempts, then
 * the oldest low-value rows (tool/result/media/note) are front-elided first,
 * and only then the oldest remaining entries — so the conversation's words
 * survive elision before its logs do. The newest entries always survive —
 * recency is the value ranking, as in VCC chunking.
 * @param nodes - ordered `{ seq, message }` projections.
 * @param config - resolved compiler configuration.
 * @returns `{ entries, stats, capped }` — `capped` records cap enforcement.
 */
export function compileRegion(nodes, config) {
  const baseBudgets = {
    textTokens: config.textTokens,
    userTextTokens: config.userTextTokens,
    toolCallTokens: config.toolCallTokens,
    toolResultExcerptTokens: config.toolResultExcerptTokens,
    toolErrorExcerptTokens: config.toolErrorExcerptTokens ?? config.toolResultExcerptTokens,
    toolResultPointerTokens: config.toolResultPointerTokens ?? Infinity
  };
  let budgets = baseBudgets;
  let result = compileNodes(nodes, config, budgets);
  let attempts = 0;
  const maxAttempts = 4;
  // Fail-open ledger: seqs of error rows a cap pass refused while still
  // over cap. A Set (not a counter) so a row refused by both passes
  // counts once; deleted if the hard truncate below cuts it as last resort.
  const keptErrorSeqs = new Set();
  while (result.stats.tokens > config.maxTokens && attempts < maxAttempts) {
    budgets = scaleBudgets(budgets, config.maxTokens / result.stats.tokens * 0.95);
    result = compileNodes(nodes, config, budgets);
    attempts += 1;
  }
  let capped = false;
  if (result.stats.tokens > config.maxTokens) {
    const entries = result.entries;
    // Phase A: drop the oldest low-value rows (tool/result/media/note)
    // anywhere in the list first, so conversation text and prior-checkpoint
    // knowledge survive elision before the logs do. The marker's seq range is
    // the dropped rows' span (approximate: surviving text may sit inside it).
    const toolRows = [];
    while (entries.length > 1 && result.stats.tokens > config.maxTokens) {
      // Fail open: error-diagnosis rows are never cap fodder — skip them
      // even here. The position guard keeps the newest entry (recency
      // invariant, same as before); error rows that block the pass while
      // still over cap are counted once, at the break site only.
      const index = entries.findIndex((entry, position) => position < entries.length - 1 && LOW_VALUE_KINDS.has(entry.kind) && entry.error !== true);
      if (index === -1) {
        for (const [position, entry] of entries.entries()) {
          if (position < entries.length - 1 && LOW_VALUE_KINDS.has(entry.kind) && entry.error === true) keptErrorSeqs.add(entry.seq);
        }
        break;
      }
      const dropped = entries.splice(index, 1)[0];
      result.stats.tokens -= estimateEntryTokens(dropped.text);
      toolRows.push(dropped);
    }
    if (toolRows.length > 0) {
      capped = true;
      result.stats.elidedToolRows += toolRows.length;
      entries.unshift({ seq: toolRows[0].seq, text: `[${toolRows.length} tool/result entries elided: ${seqRangeOf(toolRows)}]`, kind: "note" });
      result.stats.tokens += estimateEntryTokens(entries[0].text);
    }
    const elided = [];
    const droppedCheckpoints = [];
    while (entries.length > 1 && result.stats.tokens > config.maxTokens) {
      // Fail open, oldest-first pass: error rows survive shifting too, and
      // the position guard keeps the newest entry (recency invariant).
      const oldest = entries.findIndex((entry, position) => position < entries.length - 1 && entry.error !== true);
      if (oldest === -1) {
        for (const [position, entry] of entries.entries()) {
          if (position < entries.length - 1 && entry.error === true) keptErrorSeqs.add(entry.seq);
        }
        break;
      }
      const dropped = entries.splice(oldest, 1)[0];
      result.stats.tokens -= estimateEntryTokens(dropped.text);
      elided.push(dropped);
      if (dropped.kind === "checkpoint") droppedCheckpoints.push(dropped);
    }
    if (elided.length > 0) {
      capped = true;
      result.stats.elidedRows += elided.length;
      // Dropped prior checkpoints never vanish silently: each leaves a
      // single `[checkpoint N]` line the agent can restore in full via
      // recall(type:"checkpoint", id:"N").
      const markerLines = [`[${elided.length} earlier entries elided: ${seqRangeOf(elided)}]`];
      for (const dropped of droppedCheckpoints) {
        const ordinal = config.checkpointOrdinals?.get(dropped.seq);
        const ref = ordinal === undefined ? `@ seq ${dropped.seq}` : String(ordinal);
        markerLines.push(`[checkpoint ${ref}]`);
      }
      entries.unshift({ seq: elided[0].seq, text: markerLines.join("\n"), kind: "note" });
      result.stats.tokens += estimateEntryTokens(entries[0].text);
    }
    // Over cap with nothing left to drop (e.g. all remaining rows are
    // fail-open errors) is still a cap event: footer + warn must fire.
    if (result.stats.tokens > config.maxTokens) capped = true;
    if (result.stats.tokens > config.maxTokens && entries.length === 1) {
      capped = true;
      const hard = truncateTokens(entries[0].text, Math.max(8, config.maxTokens - 4), "total cap");
      entries[0] = { seq: entries[0].seq, text: hard.text, kind: entries[0].kind, ...(entries[0].error === true ? { error: true } : undefined) };
      if (entries[0].error === true) keptErrorSeqs.delete(entries[0].seq);
      result.stats.tokens = estimateEntryTokens(entries[0].text);
    }
    // Counted at the break sites above (rows refused as cap fodder while
    // still over cap) — never here, so a hard-truncated error row is not
    // misreported as kept whole.
    result.stats.keptErrorWhole = keptErrorSeqs.size;
  }
  return { ...result, capped };
}

/**
 * Normalize one compiled entry to its text: entries are `{ seq, text }`
 * pairs, but a custom compile hook may supply plain strings.
 * @param entry - entry value.
 * @returns the entry's text.
 */
export function entryText(entry) {
  return typeof entry === "string" ? entry : entry.text;
}

/**
 * Join compiled entries with separators that keep tool runs compact:
 * consecutive `tool` rows join with a single newline (no blank line), while
 * every other boundary keeps the blank line that separates entry groups.
 * Strings (guide, header, elision markers) behave like `text` entries.
 * @param entries - ordered entry texts (strings or `{ seq, text, kind }` pairs).
 * @returns the joined body text.
 */
export function joinCompiledEntries(entries) {
  let out = "";
  let previousKind;
  for (const entry of entries) {
    const kind = typeof entry === "string" ? "text" : entry.kind;
    if (out.length > 0) out += previousKind === "tool" && kind === "tool" ? "\n" : "\n\n";
    out += typeof entry === "string" ? entry : entry.text;
    previousKind = kind;
  }
  return out;
}

/**
 * Frame compiled entries as the durable replacement checkpoint content:
 * the shared preamble, the recall guide, then one tagged block (guide first,
 * then the optional intro line, the optional header line, the entries, and
 * the optional retention footer). Prior-checkpoint text copied verbatim
 * (with its own backend's tags) nests inside harmlessly.
 * @param entries - ordered entry texts (strings or `{ seq, text }` pairs).
 * @param headerLine - optional first line summarizing the compiled region.
 * @param introLine - optional first line summarizing the compaction itself.
 * @param footerLine - optional tail line reporting the verbatim retention.
 * @returns plain text content blocks.
 */
export function frameCheckpoint(entries, headerLine, introLine, footerLine) {
  const body = [RECALL_GUIDE];
  if (introLine !== undefined) body.push(introLine);
  if (headerLine !== undefined) body.push(headerLine);
  body.push(...entries);
  // `footerLine` accepts one line or an ordered list, so callers can append
  // several trailing notes (cap notice + verbatim retention) without
  // concatenating them into one unreadable paragraph.
  if (footerLine !== undefined) {
    if (Array.isArray(footerLine)) body.push(...footerLine.filter((line) => line !== undefined));
    else body.push(footerLine);
  }
  return [
    { type: "text", text: `${CHECKPOINT_PREAMBLE}\n\n${CHECKPOINT_OPEN_TAG}` },
    { type: "text", text: joinCompiledEntries(body) },
    { type: "text", text: CHECKPOINT_CLOSE_TAG }
  ];
}

export { CHECKPOINT_CLOSE_TAG, CHECKPOINT_OPEN_TAG, CHECKPOINT_PREAMBLE };
