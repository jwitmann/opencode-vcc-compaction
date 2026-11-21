/**
 * Adapter + snapshot self-test: mapping + keepID + config +
 * compile, plus the snapshot store (clean/build/session-view + search).
 *
 * New code (no upstream original to capture from), so vectors assert
 * hand-derived behavior: every part type, tool-link pointers, checkpoint
 * synthesis, skip cases, missing-id abstain, config defaults/overrides,
 * summary shape, snapshot seq alignment, recall/search over snapshots,
 * and double-run determinism.
 *
 * Run: `node selftest.mjs` (exit 0 = pass, nonzero = fail).
 * No dependencies, no network, no model, no host.
 */
import {
  DEFAULT_PLUGIN_CONFIG,
  buildConfig,
  compileCompaction,
  pickKeepID,
  projectResultValue,
  toNode,
  unwrapCheckpointSummary,
  wrapCheckpointSummary,
} from "./adapter.mjs";
import {
  MAX_SNAPSHOT_WRITE_BYTES,
  SNAPSHOT_FULL_PAYLOAD_MESSAGES,
  SNAPSHOT_MAX_MESSAGES,
  SNAPSHOT_VERSION,
  ageSnapshotPayloads,
  buildSnapshot,
  capSnapshotMessages,
  classifySnapshotStore,
  formatRecallReply,
  formatSearchReply,
  formatStatusText,
  lastMessageID,
  makeSnapshotSession,
  mergeSnapshotMessages,
  parseRecallArgs,
  parseSearchArgs,
  recallFromSnapshot,
  retainSnapshotMessages,
  searchSnapshot,
  snapshotMessageToRecall,
  snapshotNeedsWrite,
  snapshotWriteBytes,
  updateWatchStats,
} from "./snapshot.mjs";
import { parseSeqSpec, recallSession, resolveRecallReference } from "./engine/recall.mjs";
import { sessionEventAt, sessionEvents } from "./engine/session-compat.mjs";
import {
  MAX_REPLY_TEXT,
  MAX_TOAST_TEXT,
  VCC_REPLY_EVENT,
  VCC_RPC_ID,
  buildReplyPayload,
  isReplyPayload,
  replyEventType,
} from "./events.mjs";

let failures = 0;
/** Compare one vector, logging mismatch detail; counts failures. */
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`ok: ${name}`);
  else {
    failures += 1;
    console.log(`FAIL: ${name}\n  actual:   ${a}\n  expected: ${e}`);
  }
}

const MSGS = [
  { id: "msg-1", role: "user", content: [{ type: "text", text: "please fix the login bug" }] },
  { id: "msg-2", role: "assistant", content: [{ type: "tool-call", id: "t1", name: "read", input: { file_path: "auth.js" } }] },
  { id: "msg-3", role: "tool", content: [{ type: "tool-result", id: "t1", name: "read", result: { type: "json", value: { lines: 42 } } }] },
  { id: "msg-4", role: "assistant", content: [{ type: "text", text: "fixed the bug" }] },
  { id: "msg-5", role: "user", content: [{ type: "text", text: "thanks, also check logout" }] },
];

function runSuite() {
  const out = {};
  out.userNode = toNode(MSGS[0], 1);
  out.toolCallNode = toNode(MSGS[1], 2);
  out.toolNode = toNode(MSGS[2], 3);
  out.reasoningNode = toNode({ role: "assistant", content: [{ type: "reasoning", text: "think" }] }, 9);
  out.systemSkipped = toNode({ role: "system", content: [{ type: "text", text: "rules" }] }, 9);
  out.effortSkipped = toNode({ role: "assistant", content: [{ type: "effort" }] }, 9);
  out.unknownRole = toNode({ role: "alien", content: [] }, 9);
  out.badContent = toNode({ role: "user", content: null }, 9);
  out.checkpointNode = toNode({ role: "assistant", content: [{ type: "compaction", text: "prior summary body" }] }, 9);
  out.nullCheckpoint = toNode({ role: "assistant", content: [{ type: "compaction", text: null }] }, 9);
  out.circularArgs = toNode(
    (() => {
      const input = {};
      input.self = input;
      return { role: "assistant", content: [{ type: "tool-call", id: "c", name: "bash", input }] };
    })(),
    9,
  );
  out.values = {
    jsonObj: projectResultValue({ type: "json", value: { a: 1 } }),
    jsonStr: projectResultValue({ type: "json", value: "raw" }),
    text: projectResultValue({ type: "text", value: "hi" }),
    error: projectResultValue({ type: "error", value: "boom" }),
    content: projectResultValue({ type: "content", value: [{ type: "text", text: "a" }, { type: "file", uri: "u", mime: "x", name: "f" }, { type: "odd" }] }),
    missing: projectResultValue(undefined),
    bareString: projectResultValue("oops"),
  };
  out.media = {
    image: toNode({ role: "user", content: [{ type: "media", media: { mediaType: "image/png" } }] }, 9),
    doc: toNode({ role: "user", content: [{ type: "media", media: { mediaType: "application/pdf" } }] }, 9),
    blind: toNode({ role: "user", content: [{ type: "media" }] }, 9),
  };
  out.keep = [
    pickKeepID(MSGS, 2),
    pickKeepID([{ role: "user", content: [] }, { id: "b", role: "user", content: [] }], 2),
    pickKeepID([{ role: "user", content: [] }], 2),
    pickKeepID(MSGS, -3),
  ];
  out.config = [
    buildConfig(undefined),
    buildConfig({ maxTokens: 100, includeReasoning: true, hideTools: ["x", 7], noisePatterns: ["a+"] }),
    buildConfig({ maxTokens: -5, textTokens: NaN, keepMessages: 0 }),
  ];
  const full = compileCompaction(MSGS, buildConfig({}));
  out.fullKeepID = full.keepID;
  out.fullPointers = [full.summary.includes('(seq 2 -> result 3)'), full.summary.includes("RECALL:"), full.summary.includes("[opencode-vcc-compaction")];
  out.fullStats = [full.stats.nodes, full.stats.entries > 0, full.capped];
  out.abstain = compileCompaction([{ role: "user", content: [{ type: "text", text: "no ids anywhere" }] }], buildConfig({}));
  out.defaultConfig = compileCompaction([{ id: "x", role: "user", content: [{ type: "text", text: "hi" }] }]).keepID;
  out.contiguousSeqs = compileCompaction([
    { id: "u1", role: "user", content: [{ type: "text", text: "first" }] },
    { role: "system", content: [{ type: "text", text: "skipped" }] },
    { id: "t9", role: "assistant", content: [{ type: "tool-call", id: "c9", name: "bash", input: "echo hi" }] },
    { role: "tool", content: [{ type: "tool-result", id: "c9", name: "bash", result: { type: "text", value: "hi" } }] },
  ], buildConfig({})).summary.includes("(seq 2 -> result 3)");
  out.capFooter = compileCompaction(MSGS, buildConfig({ maxTokens: 30 })).summary.includes("cap enforced");
  return JSON.stringify(out);
}

const EXPECTED = JSON.stringify({
  userNode: { seq: 1, message: { role: "user", content: [{ type: "text", text: "please fix the login bug" }] } },
  toolCallNode: { seq: 2, message: { role: "assistant", content: [{ type: "tool-call", id: "t1", name: "read", arguments: "{\"file_path\":\"auth.js\"}" }] } },
  toolNode: { seq: 3, message: { role: "tool", content: [{ type: "text", text: "{\"lines\":42}" }], toolCallId: "t1" } },
  reasoningNode: { seq: 9, message: { role: "assistant", content: [{ type: "reasoning", text: "think" }] } },
  systemSkipped: null,
  effortSkipped: { seq: 9, message: { role: "assistant", content: [] } },
  unknownRole: null,
  badContent: null,
  checkpointNode: { seq: 9, message: { role: "user", content: [{ type: "text", text: "prior summary body" }], source: { kind: "compact-checkpoint" } } },
  nullCheckpoint: null,
  circularArgs: { seq: 9, message: { role: "assistant", content: [{ type: "tool-call", id: "c", name: "bash", arguments: "" }] } },
  values: {
    jsonObj: "{\"a\":1}",
    jsonStr: "raw",
    text: "hi",
    error: "[error] boom",
    content: "a\n[file f]\n[odd]",
    missing: "",
    bareString: "oops",
  },
  media: {
    image: { seq: 9, message: { role: "user", content: [{ type: "image" }] } },
    doc: { seq: 9, message: { role: "user", content: [{ type: "document" }] } },
    blind: { seq: 9, message: { role: "user", content: [{ type: "document" }] } },
  },
  keep: ["msg-4", "b", undefined, "msg-5"],
  config: [
    { ...DEFAULT_PLUGIN_CONFIG, noisePatterns: [] },
    {
      maxTokens: 100,
      textTokens: 8192,
      userTextTokens: 16384,
      toolCallTokens: 128,
      toolResultExcerptTokens: 256,
      includeReasoning: true,
      hideTools: ["x"],
      noisePatterns: "CHECK_REGEXP",
      keepMessages: 6,
      snapshotMaxMessages: 50,
      snapshotFullPayloadMessages: 20,
    },
    { ...DEFAULT_PLUGIN_CONFIG, noisePatterns: [] },
  ],
  fullKeepID: "msg-1",
  fullPointers: [true, true, true],
  fullStats: [5, true, false],
  abstain: undefined,
  defaultConfig: "x",
  contiguousSeqs: true,
  capFooter: true,
});

function normalize(actual) {
  // noisePatterns holds a compiled RegExp (not JSON-stable): assert shape
  // here; the dedicated check below proves it is a real RegExp.
  const parsed = JSON.parse(actual);
  parsed.config[1].noisePatterns = Array.isArray(parsed.config[1].noisePatterns)
    && parsed.config[1].noisePatterns.length === 1
    ? "CHECK_REGEXP"
    : parsed.config[1].noisePatterns;
  return JSON.stringify(parsed);
}

const FIRST = normalize(runSuite());
check("adapter vectors match hand-derived expectations", FIRST, EXPECTED);
check("adapter deterministic double-run", normalize(runSuite()), FIRST);
check(
  "noise patterns compile to RegExp",
  buildConfig({ noisePatterns: ["a+"] }).noisePatterns[0] instanceof RegExp,
  true,
);
check(
  "checkpoint wrap is one details layer with identical inner",
  (() => {
    const inner = "line one\n\nline two";
    const wrapped = wrapCheckpointSummary(inner, "label here");
    return wrapped.startsWith("<details>\n<summary>label here</summary>\n\n")
      && wrapped.endsWith("\n\n</details>")
      && unwrapCheckpointSummary(wrapped) === inner;
  })(),
  true,
);
check(
  "checkpoint unwrap passes foreign text through",
  [
    unwrapCheckpointSummary("plain text"),
    unwrapCheckpointSummary(""),
    unwrapCheckpointSummary("<details>\nno summary line\n\nbody\n\n</details>"),
    unwrapCheckpointSummary("<details>\n<summary>multi\nline</summary>\n\nbody\n\n</details>"),
    unwrapCheckpointSummary("<details>\n<summary>x</summary>\n\nbody, no close"),
    unwrapCheckpointSummary(null),
  ],
  [
    "plain text",
    "",
    "<details>\nno summary line\n\nbody\n\n</details>",
    "<details>\n<summary>multi\nline</summary>\n\nbody\n\n</details>",
    "<details>\n<summary>x</summary>\n\nbody, no close",
    null,
  ],
);
check(
  "wrapped checkpoint re-parses to the same node",
  (() => {
    const body = "prior summary body";
    const plain = toNode({ role: "assistant", content: [{ type: "compaction", text: body }] }, 9);
    const wrapped = toNode({ role: "assistant", content: [{ type: "compaction", text: wrapCheckpointSummary(body, "label") }] }, 9);
    return JSON.stringify(plain) === JSON.stringify(wrapped);
  })(),
  true,
);
check(
  "compiled summary stays single-layer across compactions",
  (() => {
    const count = (text, token) => text.split(token).length - 1;
    const first = compileCompaction(MSGS, buildConfig({})).summary;
    const once = count(first, "<details>") === 1 && count(first, "</details>") === 1;
    const pointers = first.includes("(seq 2 -> result 3)") && first.includes("RECALL:");
    const second = compileCompaction([
      { id: "c0", role: "assistant", content: [{ type: "compaction", text: first }] },
      { id: "u9", role: "user", content: [{ type: "text", text: "follow-up" }] },
    ], buildConfig({})).summary;
    const stillOnce = count(second, "<details>") === 1 && count(second, "</details>") === 1;
    const priorSurvived = second.includes("login");
    return once && pointers && stillOnce && priorSurvived;
  })(),
  true,
);

const SNAP_MSGS = [
  { id: "m1", role: "system", content: [{ type: "text", text: "rules" }] },
  { id: "m2", role: "user", content: [{ type: "text", text: "please fix login" }] },
  { id: "m3", role: "assistant", content: [{ type: "tool-call", id: "t1", name: "read", input: { file_path: "auth.js" } }] },
  { id: "m4", role: "tool", content: [{ type: "tool-result", id: "t1", name: "read", result: { type: "json", value: { lines: 42 } } }] },
  { id: "m5", role: "user", content: [{ type: "media", media: { mediaType: "image/png" } }] },
  { id: "m6", role: "assistant", content: [{ type: "compaction", text: "prior summary" }] },
];
const snap = buildSnapshot(SNAP_MSGS);
check("snapshot version", snap.version, SNAPSHOT_VERSION);
check("snapshot drops system", snap.messages.some((m) => m.role === "system"), false);
check("snapshot count", snap.count, 5);
check("snapshot lastID", snap.lastID, "m6");
check("snapshot media label-only", snap.messages[3], { id: "m5", role: "user", content: [{ type: "media", mediaType: "image/png" }] });
check("snapshot growth guard same", snapshotNeedsWrite({ version: snap.version, count: snap.count, lastID: snap.lastID }, snap), false);
check("snapshot growth guard grown", snapshotNeedsWrite({ version: snap.version, count: 4, lastID: "m5" }, snap), true);
check("snapshot growth guard first", snapshotNeedsWrite(undefined, snap), true);
check("snapshot growth guard version bump", snapshotNeedsWrite({ version: 0, count: snap.count, lastID: snap.lastID }, snap), true);
check("snapshot write budget is 1MB", MAX_SNAPSHOT_WRITE_BYTES, 1000000);
check("snapshot write bytes small envelope stays under budget", snapshotWriteBytes(snap) > MAX_SNAPSHOT_WRITE_BYTES, false);
check(
  "snapshot write bytes trips above 1MB",
  snapshotWriteBytes({ version: 1, messages: [{ role: "user", content: [{ type: "text", text: "x".repeat(MAX_SNAPSHOT_WRITE_BYTES + 1) }] }], count: 1 }) > MAX_SNAPSHOT_WRITE_BYTES,
  true,
);
check("snapshot write bytes unserializable never trips", snapshotWriteBytes((() => { const circular = {}; circular.self = circular; return circular; })()), 0);
check(
  "watch stats first write folds to max",
  updateWatchStats(undefined, 1234, 1000),
  { stats: { version: 1, maxWriteBytes: 1234, maxAt: 1000, tripCount: 0, lastTripwireAt: null }, changed: true },
);
check(
  "watch stats smaller write is quiet",
  updateWatchStats({ version: 1, maxWriteBytes: 1234, maxAt: 1000, tripCount: 0, lastTripwireAt: null }, 100, 2000),
  { stats: { version: 1, maxWriteBytes: 1234, maxAt: 1000, tripCount: 0, lastTripwireAt: null }, changed: false },
);
check(
  "watch stats trip records firing",
  updateWatchStats(undefined, MAX_SNAPSHOT_WRITE_BYTES + 1, 3000),
  { stats: { version: 1, maxWriteBytes: MAX_SNAPSHOT_WRITE_BYTES + 1, maxAt: 3000, tripCount: 1, lastTripwireAt: 3000 }, changed: true },
);
check(
  "watch stats trips accumulate",
  updateWatchStats({ version: 1, maxWriteBytes: MAX_SNAPSHOT_WRITE_BYTES + 5, maxAt: 3000, tripCount: 2, lastTripwireAt: 3000 }, MAX_SNAPSHOT_WRITE_BYTES + 1, 4000),
  { stats: { version: 1, maxWriteBytes: MAX_SNAPSHOT_WRITE_BYTES + 5, maxAt: 3000, tripCount: 3, lastTripwireAt: 4000 }, changed: true },
);
check(
  "watch stats malformed previous folds from zero",
  updateWatchStats("junk", 50, 7),
  { stats: { version: 1, maxWriteBytes: 50, maxAt: 7, tripCount: 0, lastTripwireAt: null }, changed: true },
);
check(
  "watch stats zero-byte write stays quiet",
  updateWatchStats(undefined, 0, 7),
  { stats: { version: 1, maxWriteBytes: 0, maxAt: null, tripCount: 0, lastTripwireAt: null }, changed: false },
);

const session = makeSnapshotSession(snap.messages);
const events = sessionEvents(session);
check("snapshot session event count (system dropped)", events.length, 5);
check("snapshot seqs are 1-based contiguous", events.map((e) => e.seq), [1, 2, 3, 4, 5]);
check("snapshot tool event typed for result refs", events[2].type, "tool/result");
check("snapshot checkpoint typed", events[4].type, "user/message");
check("snapshot eventAt", sessionEventAt(session, 2)?.seq, 2);
const recalled = recallSession(session, parseSeqSpec("2-3").selections, { maxRecallTokens: 16000 });
check("snapshot recall text has tool call + result", recalled.text.includes("[tool-call read]") && recalled.text.includes("42"), true);
const resolved = resolveRecallReference(session, "result", "result 3");
check("snapshot result ref resolves", resolved.selections, [{ start: 3, end: 3 }]);
const searched = searchSnapshot(snap.messages, "login", { maxSearchHits: 50, maxRecallTokens: 16000 });
check("snapshot search finds login", searched.totalMatches >= 1 && searched.text.includes("[seq 1"), true);
const recallMsg = snapshotMessageToRecall(snap.messages[0]);
check("snapshot recall projection role", recallMsg.role, "user");
check("snapshot deterministic double-run", JSON.stringify(buildSnapshot(SNAP_MSGS)), JSON.stringify(buildSnapshot(SNAP_MSGS)));
check("snapshot empty user shell kept (seq alignment)", buildSnapshot([{ role: "user", content: [] }]).count, 1);
check("snapshot empty tool shell kept (seq alignment)", buildSnapshot([{ role: "tool", content: [] }]).count, 1);
check("snapshot typeless part dropped", buildSnapshot([{ id: "x", role: "user", content: [{ foo: 1 }] }]).messages, [{ id: "x", role: "user", content: [] }]);
check(
  "snapshot missing tool input recalls empty (not null)",
  recallFromSnapshot([{ role: "assistant", content: [{ type: "tool-call", id: "c", name: "bash" }] }], [{ start: 1, end: 1 }]).text.includes("null"),
  false,
);
check("snapshot search defaults on empty config", searchSnapshot(snap.messages, "login").totalMatches >= 1, true);
check("snapshot recall defaults on undefined budget", recallFromSnapshot(snap.messages, [{ start: 1, end: 1 }], undefined).recalled, 1);

// Retention bounds: K=50 newest-wins, full payloads on the newest 20.
check("retention constants", [SNAPSHOT_MAX_MESSAGES, SNAPSHOT_FULL_PAYLOAD_MESSAGES], [50, 20]);
check("lastMessageID newest", lastMessageID([{ id: "a" }, { id: "b" }, { role: "user", content: [] }]), "b");
check("lastMessageID none", lastMessageID([{ role: "user", content: [] }]), undefined);

const MERGE_PREV = [
  { id: "m1", role: "user", content: [{ type: "text", text: "needle-alpha-1" }] },
  { id: "m2", role: "assistant", content: [{ type: "text", text: "ack" }] },
  { id: "m3", role: "tool", content: [{ type: "tool-result", id: "t1", name: "read", result: { type: "json", value: { n: 1 } } }] },
];
const MERGE_NEXT = [...MERGE_PREV, { id: "m4", role: "user", content: [{ type: "text", text: "tail question" }] }];
check(
  "merge fast path appends suffix",
  mergeSnapshotMessages(MERGE_PREV, MERGE_NEXT).map((m) => m.id),
  ["m1", "m2", "m3", "m4"],
);
check(
  "merge fallback dedupes by id",
  mergeSnapshotMessages(MERGE_PREV, [...MERGE_NEXT, { id: "m2", role: "assistant", content: [{ type: "text", text: "dup" }] }]).map((m) => m.id),
  ["m1", "m2", "m3", "m4"],
);
check("merge empty previous copies next", mergeSnapshotMessages(undefined, MERGE_NEXT).length, 4);
check("merge does not mutate inputs", [MERGE_PREV.length, MERGE_NEXT.length], [3, 4]);
check(
  "merge keeps checkpoint inserted mid-list",
  mergeSnapshotMessages(
    [{ id: "m1", role: "user", content: [] }, { id: "m2", role: "assistant", content: [] }],
    [
      { id: "s1", role: "user", content: [{ type: "text", text: "checkpoint" }] },
      { id: "m2", role: "assistant", content: [] },
      { id: "m3", role: "user", content: [] },
    ],
  ).map((m) => m.id),
  ["m1", "m2", "s1", "m3"],
);
check(
  "merge duplicate anchor appends once",
  mergeSnapshotMessages(
    [{ id: "m1", role: "user", content: [] }, { id: "m2", role: "assistant", content: [] }],
    [{ id: "m2", role: "assistant", content: [] }, { id: "m2", role: "assistant", content: [] }, { id: "m3", role: "user", content: [] }],
  ).map((m) => m.id),
  ["m1", "m2", "m3"],
);
check(
  "merge id-less newest-wins",
  mergeSnapshotMessages([{ role: "user", content: [] }], [{ role: "user", content: [{ type: "text", text: "new" }] }]),
  [{ role: "user", content: [{ type: "text", text: "new" }] }],
);

const MANY = Array.from({ length: 55 }, (_, i) => ({ id: `k${i}`, role: "user", content: [{ type: "text", text: `t${i}` }] }));
const CAPPED = capSnapshotMessages(MANY);
check("cap keeps newest K", [CAPPED.length, CAPPED[0].id, CAPPED[49].id], [50, "k5", "k54"]);
check("cap small list copies", capSnapshotMessages(MERGE_PREV).length, 3);

const PAYLOADED = Array.from({ length: 25 }, (_, i) => ({
  id: `p${i}`,
  role: "tool",
  content: [{ type: "tool-result", id: `t${i}`, name: "read", result: { type: "json", value: { i } } }],
}));
const AGED = ageSnapshotPayloads(PAYLOADED);
check("age keeps newest payloads", AGED[24].content[0].result, { type: "json", value: { i: 24 } });
check("age marks old payloads", [AGED[0].content[0].result, AGED[0].content[0].aged], [null, true]);
check("age keeps identity", [AGED[0].content[0].name, AGED[0].content[0].id], ["read", "t0"]);
check("age is idempotent", AGED[0].content[0], ageSnapshotPayloads(AGED)[0].content[0]);

// Round-4 scenario: prefix needle must survive a compaction-like tail.
const PREFIX_RAW = [
  { id: "r1", role: "user", content: [{ type: "text", text: "plant needle-deep-9 in the vault" }] },
  { id: "r2", role: "assistant", content: [{ type: "tool-call", id: "c1", name: "write", input: { f: "a" } }] },
  { id: "r3", role: "tool", content: [{ type: "tool-result", id: "c1", name: "write", result: { type: "text", value: "ok needle-deep-9" } }] },
];
const PREV_CLEAN = buildSnapshot(PREFIX_RAW).messages;
const TAIL_RAW = [
  { id: "ckpt", role: "assistant", content: [{ type: "compaction", text: "checkpoint prose" }] },
  { id: "r4", role: "user", content: [{ type: "text", text: "new tail turn" }] },
];
check(
  "replace-mode control drops prefix",
  searchSnapshot(buildSnapshot(TAIL_RAW).messages, "needle-deep-9").totalMatches,
  0,
);
const RETAINED = retainSnapshotMessages(PREV_CLEAN, TAIL_RAW);
check("retain keeps prefix across compaction", RETAINED.messages.map((m) => m.id), ["r1", "r2", "r3", "ckpt", "r4"]);
check("retain meta", [RETAINED.count, RETAINED.lastID], [5, "r4"]);
check("retain prefix needle searchable", searchSnapshot(RETAINED.messages, "needle-deep-9").totalMatches >= 1, true);
const BIG_RAW = Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, role: "user", content: [{ type: "text", text: `bulk ${i}` }] }));
const RETAINED_BIG = retainSnapshotMessages(undefined, BIG_RAW);
check("retain caps at K", [RETAINED_BIG.count, RETAINED_BIG.messages[0].id], [50, "b10"]);
check(
  "config retention defaults",
  [buildConfig({}).snapshotMaxMessages, buildConfig({}).snapshotFullPayloadMessages],
  [50, 20],
);
check(
  "config retention override",
  buildConfig({ snapshotMaxMessages: 10, snapshotFullPayloadMessages: 5 }).snapshotMaxMessages,
  10,
);
check(
  "config retention invalid falls back",
  buildConfig({ snapshotMaxMessages: -3, snapshotFullPayloadMessages: NaN }).snapshotMaxMessages,
  50,
);
check(
  "retain honors custom bounds",
  retainSnapshotMessages(undefined, BIG_RAW, { maxMessages: 5 }).count,
  5,
);
check("recall args seq range", parseRecallArgs("/vcc-recall 3-7"), { type: "seq", id: "3-7" });
check("recall args bare seq", parseRecallArgs("seq 12"), { type: "seq", id: "seq 12" });
check("recall args result", parseRecallArgs("/vcc-recall result 3"), { type: "result", id: "3" });
check("recall args checkpoint", parseRecallArgs("checkpoint 1"), { type: "checkpoint", id: "1" });
check("recall args empty is usage", "error" in parseRecallArgs("/vcc-recall"), true);
check("recall args result needs id", "error" in parseRecallArgs("/vcc-recall result"), true);
check("recall args checkpoint needs id", "error" in parseRecallArgs("/vcc-recall checkpoint"), true);
check("snapshot search never surfaces seq 0", searchSnapshot(snap.messages, "e", { maxSearchHits: 50, maxRecallTokens: 16000 }).hits.every((hit) => hit.seq !== 0), true);
check(
  "snapshot recall tolerates nullish stored parts",
  snapshotMessageToRecall({ role: "user", content: [null, { type: "text", text: "hi" }, { noType: true }] }).content,
  [{ type: "text", text: "hi" }],
);
check("search args strips prefix", parseSearchArgs("/vcc-search login"), { pattern: "login" });
check("search args raw pattern", parseSearchArgs("foo.*bar"), { pattern: "foo.*bar" });
check("search args empty is usage", "error" in parseSearchArgs("/vcc-search"), true);
const statusText = formatStatusText(
  { version: 1, messages: snap.messages, count: snap.count, lastID: snap.lastID, writtenAt: 1000000 },
  { maxTokens: 8192, keepMessages: 6, includeReasoning: false, hideTools: [], noisePatterns: [] },
  "test-rev",
  1000120,
);
check("status text reports engine rev + config + snapshot", statusText.includes("test-rev") && statusText.includes("5 message(s)"), true);
check("status text handles no snapshot", formatStatusText(undefined, {}, "r", 0).includes("none yet"), true);
check("status text never throws on garbage", formatStatusText({ messages: "nope" }, null, "r", NaN).includes("/vcc-status"), true);
check("snapshot store classifies failed", classifySnapshotStore({ __vccReadFailed: true }), { status: "failed" });
check("snapshot store classifies empty", classifySnapshotStore(undefined).status, "empty");
check("snapshot store classifies ready", classifySnapshotStore({ version: 1, messages: snap.messages, count: snap.count }).status, "ready");
check(
  "snapshot search summary stays consistent after hole filtering",
  (() => {
    const out = searchSnapshot(snap.messages, "e", { maxSearchHits: 50, maxRecallTokens: 16000 });
    return out.hits.every((hit) => hit.seq !== 0) && out.omitted === out.totalMatches - out.hits.length;
  })(),
  true,
);
check(
  "snapshot search index-0 hole steals no hit slot",
  (() => {
    const out = searchSnapshot(snap.messages, "e", { maxSearchHits: 1, maxRecallTokens: 16000 });
    return out.hits.length === 1 && out.hits[0].seq === 1 && out.omitted === out.totalMatches - out.hits.length;
  })(),
  true,
);
check(
  "snapshot search never matches the index-0 hole",
  (() => {
    const out = searchSnapshot(snap.messages, "session\\.created", { maxSearchHits: 50, maxRecallTokens: 16000 });
    return out.totalMatches === 0 && out.hits.length === 0;
  })(),
  true,
);
check(
  "recall reply labels provenance",
  formatRecallReply("seq", "1", { seqs: [1], tokens: 10, missing: 0, truncated: false, text: "hi" }),
  "**/vcc-recall seq 1** (1 event(s), 10 tokens)\n\nhi",
);
check(
  "search reply labels pattern",
  formatSearchReply("login", { totalMatches: 1, text: "hit" }),
  "**/vcc-search login** (1 matching event(s))\n\nhit",
);
const recallCmd = (() => {
  const parsed = parseRecallArgs("/vcc-recall 2-3");
  if ("error" in parsed) return null;
  const cmdSession = makeSnapshotSession(snap.messages);
  const resolved = resolveRecallReference(cmdSession, parsed.type, parsed.id);
  if (resolved.errors.length > 0) return null;
  return recallFromSnapshot(snap.messages, resolved.selections);
})();
check("recall command flow restores text", recallCmd !== null && recallCmd.text.includes("[tool-call read]"), true);
check("reply event type", replyEventType(), `rpc.${VCC_RPC_ID}.${VCC_REPLY_EVENT}`);
check("reply payload shape", buildReplyPayload("ses_1", "/vcc-status", "ok"), {
  sessionID: "ses_1",
  command: "/vcc-status",
  text: "ok",
});
check("reply payload truncates", buildReplyPayload("s", "/c", "x".repeat(MAX_REPLY_TEXT + 1)), {
  sessionID: "s",
  command: "/c",
  text: `${"x".repeat(MAX_REPLY_TEXT)}\n\n[truncated: reply exceeds ${MAX_REPLY_TEXT} chars — narrow the selection and retry]`,
});
check("reply toast threshold", MAX_TOAST_TEXT, 300);
check(
  "reply payload validates",
  isReplyPayload(buildReplyPayload("ses_1", "/vcc-status", "ok")) &&
    !isReplyPayload(null) &&
    !isReplyPayload({ sessionID: "ses_1" }),
  true,
);

if (failures > 0) {
  console.log(`selftest FAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log("selftest passed");
