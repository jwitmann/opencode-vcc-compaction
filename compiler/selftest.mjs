/**
 * Self-test: stage 1 (tokenizer + budget primitives) and stage 2
 * (region compiler).
 *
 * Expected values were captured from the original
 * dsh-compaction-vcc@0.7.4 `src/compiler.js` (run 2026-11-19) — the port
 * must reproduce them exactly. Determinism: every vector runs twice and
 * the outputs must be byte-identical.
 *
 * Run: `node compiler/selftest.mjs` (exit 0 = pass, nonzero = fail).
 * No dependencies, no network, no model.
 */
import {
  countTokens,
  estimateEntryTokens,
  isCjkChar,
  sanitize,
  tailTokens,
  tokenize,
  truncateTokens,
} from "./tokenize.mjs";
import {
  compileNodes,
  compileNoisePatterns,
  compileRegion,
  entryText,
  excerptToolResult,
  frameCheckpoint,
  joinCompiledEntries,
  stripNoiseXml,
  DEFAULT_NOISE_PATTERNS,
} from "./compile.mjs";

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

// Runs the whole vector suite twice and returns the serialized outputs,
// so the second run proves determinism (byte-identical).
function runSuite() {
  const out = [];
  out.push(tokenize("Hello, world 123"));
  out.push(tokenize("a😀b"));
  out.push(countTokens("สวัสดีครับ"));
  out.push(isCjkChar("ส"));
  out.push(isCjkChar("a"));
  out.push(estimateEntryTokens("1".repeat(100)));
  out.push(sanitize("a\r\n\x1b[31mhi\x00!"));
  out.push(truncateTokens("one two three four", 2));
  out.push(truncateTokens("one two three four", 2, "seq 5"));
  out.push(truncateTokens("x".repeat(40) + "😀" + "y".repeat(40), 10));
  out.push(tailTokens("one two three four", 2));
  return JSON.stringify(out);
}

const EXPECTED = JSON.stringify([
  ["Hello", ",", " ", "world", " ", "123"],
  ["a", "\ud83d", "\ude00", "b"],
  10,
  true,
  false,
  30,
  "a\nhi!",
  { text: "one two...(truncated)", truncated: true },
  { text: "one two...(truncated from seq 5)", truncated: true },
  { text: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...(truncated)", truncated: true },
  { text: "...(elided before) three four", truncated: true },
]);

const FIRST = runSuite();
check("vectors match original", FIRST, EXPECTED);
check("deterministic double-run", runSuite(), FIRST);

// ── stage 2: region compiler (compile.mjs) ─────────────────────────────

const CFG2 = {
  textTokens: 8,
  userTextTokens: 8,
  toolCallTokens: 8,
  toolResultExcerptTokens: 16,
  maxTokens: 120,
  includeReasoning: false,
  stripNoiseXml: true,
  noisePatterns: compileNoisePatterns(DEFAULT_NOISE_PATTERNS),
  hideTools: ["job_output"],
};

const NODES2 = [
  { seq: 1, message: { role: "user", content: [{ type: "text", text: "Please read a.js <ide_opened_file>a.js</ide_opened_file> and fix the bug" }] } },
  { seq: 2, message: { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "read", arguments: JSON.stringify({ file_path: "a.js" }) }] } },
  { seq: 3, message: { role: "tool", toolCallId: "c1", content: [{ type: "text", text: "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10" }] } },
  { seq: 4, message: { role: "assistant", content: [{ type: "tool-call", id: "c2", name: "job_output", arguments: "{}" }] } },
  { seq: 5, message: { role: "assistant", content: [{ type: "reasoning", text: "hidden chain of thought here" }] } },
  { seq: 6, message: { role: "assistant", content: [{ type: "text", text: "The bug is fixed now and everything passes" }] } },
  { seq: 7, message: null },
  { seq: 8, message: { role: "user", content: null } },
  { seq: 9, message: { role: "user", content: [null, { type: "text", text: "ok" }] } },
  { seq: 10, message: { role: "assistant", content: [{ type: "tool-call", id: "c3", name: "bash", arguments: "not-json{{{ " }] } },
  { seq: 11, message: { role: "user", content: [{ type: "text", text: "<system-reminder>noise</system-reminder>" }] } },
];

function bigRegion() {
  const nodes = [];
  for (let i = 0; i < 30; i += 1) {
    nodes.push({ seq: 100 + i * 2, message: { role: "assistant", content: [{ type: "tool-call", id: `k${i}`, name: "read", arguments: JSON.stringify({ file_path: `f${i}.js` }) }] } });
    nodes.push({ seq: 101 + i * 2, message: { role: "tool", toolCallId: `k${i}`, content: [{ type: "text", text: `output of f${i} `.repeat(40) }] } });
  }
  nodes.push({ seq: 200, message: { role: "user", content: [{ type: "text", text: "final question here" }] } });
  return nodes;
}

function runSuite2() {
  const nodes = compileNodes(NODES2, CFG2);
  const region = compileRegion(bigRegion(), { ...CFG2, maxTokens: 200 });
  return JSON.stringify({
    toolCallLine: nodes.entries.filter((e) => e.kind === "tool").map(entryText),
    allKinds: nodes.entries.map((e) => e.kind),
    allSeqs: nodes.entries.map((e) => e.seq),
    noiseStripped: nodes.entries.find((e) => e.seq === 1).text,
    unparseableArgs: nodes.entries.find((e) => e.seq === 10).text,
    noiseOnlyUser: nodes.entries.find((e) => e.seq === 11).text,
    hiddenDropped: nodes.entries.some((e) => e.seq === 4),
    reasoningElided: nodes.entries.some((e) => e.seq === 5),
    excerpt: excerptToolResult("aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll", 6, "seq 3"),
    strip: stripNoiseXml("a <ide_selection>x</ide_selection> b", CFG2.noisePatterns),
    joined: joinCompiledEntries([{ seq: 1, text: "* read (seq 1)", kind: "tool" }, { seq: 2, text: "* edit (seq 2)", kind: "tool" }, { seq: 3, text: "[user]\nhi", kind: "text" }]),
    framed: frameCheckpoint(["body line"], "H", "I", "F").map((b) => b.text),
    capTokens: region.stats.tokens,
    capped: region.capped,
    capFirstKind: region.entries[0].kind,
    capMarker: region.entries[0].text,
    capEntryCount: region.entries.length,
    everyEntryCarriesSeq: region.entries.every((e) => typeof e.seq === "number"),
    capHolds: region.stats.tokens <= 200,
  });
}

const EXPECTED2 = JSON.stringify({
  toolCallLine: ["[assistant]\n* read \"a.js\" (seq 2 -> result 3)", "[assistant]\n* bash (seq 10)"],
  allKinds: ["text", "tool", "result", "text", "text", "tool", "note"],
  allSeqs: [1, 2, 3, 6, 9, 10, 11],
  noiseStripped: "[user]\nPlease read a.js  and fix the...(truncated from seq 1)",
  unparseableArgs: "[assistant]\n* bash (seq 10)",
  noiseOnlyUser: "[user]\n* [user message elided: noise-only] (seq 11)",
  hiddenDropped: false,
  reasoningElided: false,
  excerpt: "aaa bbb ccc ddd eee fff ggg hhh...(truncated from seq 3)\n...(elided from seq 3)\n...(elided before seq 3) eee fff ggg hhh iii jjj kkk lll",
  strip: "a  b",
  joined: "* read (seq 1)\n* edit (seq 2)\n\n[user]\nhi",
  framed: [
    "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.\n\n<compacted-checkpoint>",
    "RECALL: append-only log — nothing is lost. `recall` restores original content: type \"seq\", id \"3-7\"; \"result\", id \"3\"; \"checkpoint\", id \"1\" (`[checkpoint N]` = dropped). `search` finds by keyword.\n\nI\n\nH\n\nbody line\n\nF",
    "</compacted-checkpoint>",
  ],
  capTokens: 198,
  capped: true,
  capFirstKind: "note",
  capMarker: "[55 tool/result entries elided: seqs 100-154]",
  capEntryCount: 7,
  everyEntryCarriesSeq: true,
  capHolds: true,
});

const FIRST2 = runSuite2();
check("stage-2 vectors match original", FIRST2, EXPECTED2);
check("stage-2 deterministic double-run", runSuite2(), FIRST2);

if (failures > 0) {
  console.log(`selftest FAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log("selftest passed");
