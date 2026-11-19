/**
 * vcc-plugin adapter self-test: mapping + keepID + config + compile.
 *
 * New code (no upstream original to capture from), so vectors assert
 * hand-derived behavior: every part type, tool-link pointers, checkpoint
 * synthesis, skip cases, missing-id abstain, config defaults/overrides,
 * summary shape, and double-run determinism.
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
  out.fullPointers = [full.summary.includes('(seq 2 -> result 3)'), full.summary.includes("RECALL:"), full.summary.includes("[vcc-compaction")];
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

if (failures > 0) {
  console.log(`selftest FAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log("selftest passed");
