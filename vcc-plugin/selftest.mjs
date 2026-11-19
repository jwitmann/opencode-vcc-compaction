/**
 * vcc-plugin adapter + snapshot self-test: mapping + keepID + config +
 * compile, plus the snapshot store (clean/build/session-view + search).
 *
 * New code (no upstream original to capture from), so vectors assert
 * hand-derived behavior: every part type, tool-link pointers, checkpoint
 * synthesis, skip cases, missing-id abstain, config defaults/overrides,
 * summary shape, snapshot seq alignment, recall/search over snapshots,
 * and double-run determinism.
 *
 * Run: `node vcc-plugin/selftest.mjs` (exit 0 = pass, nonzero = fail).
 * No dependencies, no network, no model, no host.
 */
import {
  DEFAULT_PLUGIN_CONFIG,
  buildConfig,
  compileCompaction,
  pickKeepID,
  projectResultValue,
  toNode,
} from "./adapter.mjs";
import {
  SNAPSHOT_VERSION,
  buildSnapshot,
  classifySnapshotStore,
  formatRecallReply,
  formatSearchReply,
  formatStatusText,
  makeSnapshotSession,
  parseRecallArgs,
  parseSearchArgs,
  recallFromSnapshot,
  searchSnapshot,
  snapshotMessageToRecall,
  snapshotNeedsWrite,
} from "./snapshot.mjs";
import { parseSeqSpec, recallSession, resolveRecallReference } from "./engine/recall.mjs";
import { sessionEventAt, sessionEvents } from "./engine/session-compat.mjs";

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
  "search omits phantom pad without undercount",
  (() => {
    const out = searchSnapshot(snap.messages, "e", { maxSearchHits: 50, maxRecallTokens: 16000 });
    return out.hits.every((hit) => hit.seq !== 0) && out.omitted === out.totalMatches - out.hits.length;
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

if (failures > 0) {
  console.log(`selftest FAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log("selftest passed");
