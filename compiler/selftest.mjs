/**
 * Self-test: stages 1–4 (tokenizer + budget primitives, region
 * compiler, recall core, search core).
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
import {
  DEFAULT_MAX_RECALL_TOKENS,
  MAX_RECALL_SPAN,
  expandSelections,
  findCheckpointSeqs,
  parseSeqSpec,
  projectMessageText,
  recallSession,
  resolveRecallReference,
} from "./recall.mjs";
import {
  hasSessionEventAccess,
} from "./session-compat.mjs";
import {
  DEFAULT_MAX_SEARCH_HITS,
  MAX_LINES_PER_HIT,
  compileSearchPattern,
  searchSession,
} from "./search.mjs";

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

// ── stage 3: recall core (recall.mjs) ─────────────────────────────────
// Expected values captured from the original dsh-compaction-vcc@0.7.4
// src/recall.js (run 2026-11-19); the port must reproduce them exactly.
// The session fixture below mirrors a durable log: `events` array plus
// `deriveEventMessage`, null for the log-only event (seq 6).

const EVENTS3 = [
  { seq: 1, type: "user/message", data: { source: { kind: "user" } } },
  { seq: 2, type: "assistant/message", data: {} },
  { seq: 3, type: "assistant/message", data: {} },
  { seq: 4, type: "tool/result", data: { result: "file contents line one two three" } },
  { seq: 5, type: "user/message", data: { source: { kind: "compact-checkpoint", compactionId: "c1" } } },
  { seq: 6, type: "session/marker", data: { note: "log only event" } },
  { seq: 7, type: "assistant/message", data: {} },
];

const MESSAGES3 = {
  1: { role: "user", content: [{ type: "text", text: "hello world this is the first question" }] },
  2: { role: "assistant", content: [{ type: "text", text: "Here is the answer with many details inside" }] },
  3: { role: "assistant", content: [{ type: "tool-call", id: "t1", name: "read", arguments: JSON.stringify({ file_path: "a.js" }) }] },
  4: { role: "tool", toolCallId: "t1", content: [{ type: "text", text: "file contents here line1 line2 line3 line4" }] },
  5: { role: "user", content: [{ type: "text", text: "prior checkpoint body that was compiled earlier and framed" }] },
  7: { role: "assistant", content: [{ type: "reasoning", text: "private chain of thought" }, { type: "text", text: "final visible answer" }] },
};

const SESSION3 = {
  events: EVENTS3,
  deriveEventMessage(event) {
    return MESSAGES3[event.seq] ?? null;
  },
};

function runSuite3() {
  return JSON.stringify({
    spec12: parseSeqSpec("12"),
    specRange: parseSeqSpec("3-7,15"),
    specSeqWord: parseSeqSpec("seq 12"),
    specParen: parseSeqSpec("(seqs 3-7)"),
    specEmpty: parseSeqSpec(""),
    specBad: parseSeqSpec("abc"),
    specReversed: parseSeqSpec("7-3"),
    specZero: parseSeqSpec("0"),
    specWide: parseSeqSpec("1-2000"),
    specUnsafe: parseSeqSpec("9007199254740993"),
    expand: expandSelections([{ start: 1, end: 3 }, { start: 2, end: 5 }]),
    project: projectMessageText({ content: [
      { type: "text", text: "hi" },
      { type: "reasoning", text: "think" },
      { type: "tool-call", name: "edit", arguments: "{}" },
      { type: "tool-result", content: [{ type: "text", text: "done" }] },
      { type: "image" },
      { type: "document" },
      { type: "weird" },
    ] }),
    checkpoints: findCheckpointSeqs(SESSION3),
    refSeq: resolveRecallReference(SESSION3, "seq", "1-2,5"),
    refResult: resolveRecallReference(SESSION3, "result", "result 4"),
    refResultBare: resolveRecallReference(SESSION3, "result", "4"),
    refResultMissing: resolveRecallReference(SESSION3, "result", "result 99"),
    refResultWrongKind: resolveRecallReference(SESSION3, "result", "2"),
    refCheckpoint: resolveRecallReference(SESSION3, "checkpoint", "1"),
    refCheckpointMissing: resolveRecallReference(SESSION3, "checkpoint", "checkpoint 2"),
    refCheckpointSeq: resolveRecallReference(SESSION3, "checkpoint", "seq 5"),
    refCheckpointNotNode: resolveRecallReference(SESSION3, "checkpoint", "seq 2"),
    refBogus: resolveRecallReference(SESSION3, "bogus", "1"),
    full: recallSession(SESSION3, [{ start: 1, end: 2 }], { maxRecallTokens: 16000 }),
    missing: recallSession(SESSION3, [{ start: 99, end: 99 }], { maxRecallTokens: 16000 }),
    logOnly: recallSession(SESSION3, [{ start: 6, end: 6 }], { maxRecallTokens: 16000 }),
    tight: recallSession(SESSION3, [{ start: 1, end: 7 }], { maxRecallTokens: 30 }),
    consts: [DEFAULT_MAX_RECALL_TOKENS, MAX_RECALL_SPAN],
    access: [hasSessionEventAccess(SESSION3), hasSessionEventAccess(null), hasSessionEventAccess({}), hasSessionEventAccess({ events: [] })],
  });
}

const EXPECTED3 = JSON.stringify({
  spec12: { selections: [{ start: 12, end: 12 }], errors: [] },
  specRange: { selections: [{ start: 3, end: 7 }, { start: 15, end: 15 }], errors: [] },
  specSeqWord: { selections: [{ start: 12, end: 12 }], errors: [] },
  specParen: { selections: [{ start: 3, end: 7 }], errors: [] },
  specEmpty: { selections: [], errors: ["missing seq selection"] },
  specBad: { selections: [], errors: ["invalid seq selection \"abc\""] },
  specReversed: { selections: [], errors: ["invalid seq range \"7-3\" (end before start)"] },
  specZero: { selections: [], errors: ["invalid seq selection \"0\" (seq starts at 1)"] },
  specWide: { selections: [], errors: ["seq range \"1-2000\" is wider than the 1000-seq limit"] },
  specUnsafe: { selections: [], errors: ["seq selection \"9007199254740993\" is outside the safe integer range"] },
  expand: [1, 2, 3, 4, 5],
  project: "hi\n[reasoning]\nthink\n[tool-call edit]\n{}\n[tool-result]\ndone\n[image]\n[document]\n[weird]",
  checkpoints: [5],
  refSeq: { selections: [{ start: 1, end: 2 }, { start: 5, end: 5 }], errors: [] },
  refResult: { selections: [{ start: 4, end: 4 }], errors: [] },
  refResultBare: { selections: [{ start: 4, end: 4 }], errors: [] },
  refResultMissing: { selections: [], errors: ["result seq 99 not found in this session"] },
  refResultWrongKind: { selections: [], errors: ["seq 2 is not a tool result (it is assistant/message)"] },
  refCheckpoint: { selections: [{ start: 5, end: 5 }], errors: [] },
  refCheckpointMissing: { selections: [], errors: ["checkpoint 2 not found (this session has 1 checkpoint(s))"] },
  refCheckpointSeq: { selections: [{ start: 5, end: 5 }], errors: [] },
  refCheckpointNotNode: { selections: [], errors: ["seq 2 is not a checkpoint node"] },
  refBogus: { selections: [], errors: ["invalid recall type \"bogus\" (expected \"seq\", \"result\", or \"checkpoint\")"] },
  full: {
    text: "[seq 1: user]\nhello world this is the first question\n\n[seq 2: assistant]\nHere is the answer with many details inside",
    entries: [
      { seq: 1, text: "[seq 1: user]\nhello world this is the first question", truncated: false },
      { seq: 2, text: "[seq 2: assistant]\nHere is the answer with many details inside", truncated: false },
    ],
    seqs: [1, 2],
    recalled: 2,
    missing: 0,
    skipped: 0,
    truncated: false,
    tokens: 35,
  },
  missing: {
    text: "[seq 99: not found in this session]",
    entries: [{ seq: 99, text: "[seq 99: not found in this session]" }],
    seqs: [],
    recalled: 0,
    missing: 1,
    skipped: 0,
    truncated: false,
    tokens: 11,
  },
  logOnly: {
    text: "[seq 6: session/marker]\n{\"note\":\"log only event\"}",
    entries: [{ seq: 6, text: "[seq 6: session/marker]\n{\"note\":\"log only event\"}", truncated: false }],
    seqs: [6],
    recalled: 1,
    missing: 0,
    skipped: 0,
    truncated: false,
    tokens: 19,
  },
  tight: {
    text: "[seq 1: user]\nhello world this is the first question\n\n[seq 2: assistant]\nHere is the answer with many details...(truncated from recall budget)\n\n[recall budget exhausted: 5 further requested seq(s) not included]",
    entries: [
      { seq: 1, text: "[seq 1: user]\nhello world this is the first question", truncated: false },
      { seq: 2, text: "[seq 2: assistant]\nHere is the answer with many details...(truncated from recall budget)", truncated: true },
      { seq: 3, text: "[recall budget exhausted: 5 further requested seq(s) not included]" },
    ],
    seqs: [1, 2],
    recalled: 2,
    missing: 0,
    skipped: 5,
    truncated: true,
    tokens: 63,
  },
  consts: [16000, 1000],
  access: [true, false, false, true],
});

const FIRST3 = runSuite3();
check("stage-3 vectors match original", FIRST3, EXPECTED3);
check("stage-3 deterministic double-run", runSuite3(), FIRST3);

// ── stage 4: search core (search.mjs) ───────────────────────────────────
// Expected values captured from the original dsh-compaction-vcc@0.7.4
// src/search.js (run 2026-11-19); the port must reproduce them exactly.
// The fixture is 0-based positional (index i holds seq i), matching the
// upstream positional scan (`events[seq]`, `event.seq === seq`) carried
// verbatim — see the `search.mjs` header.

const NEEDLE_LINES4 = Array.from({ length: 15 }, (_, i) => `needle line number ${i}`).join("\n");

const EVENTS4 = [
  { seq: 0, type: "session/start", data: { v: 1 } },
  { seq: 1, type: "user/message", data: {} },
  { seq: 2, type: "assistant/message", data: {} },
  { seq: 3, type: "assistant/message", data: {} },
  { seq: 4, type: "tool/result", data: { trace: "stack trace line one\nstack trace line two" } },
  { seq: 5, type: "user/message", data: {} },
  { seq: 6, type: "assistant/message", data: {} },
];

const MESSAGES4 = {
  1: { role: "user", content: [{ type: "text", text: "please fix the login bug urgently" }] },
  2: { role: "assistant", content: [{ type: "text", text: "the bug is in auth.js, fixing now" }] },
  3: { role: "assistant", content: [{ type: "tool-call", id: "t9", name: "read", arguments: JSON.stringify({ file_path: "auth.js" }) }] },
  5: { role: "user", content: [{ type: "text", text: "thanks, also check the logout flow" }] },
  6: { role: "assistant", content: [{ type: "text", text: NEEDLE_LINES4 }] },
};

const SESSION4 = {
  events: EVENTS4,
  deriveEventMessage(event) {
    return MESSAGES4[event.seq] ?? null;
  },
};

// Error text ends in the regex engine's own message, which varies by Node
// version — the helper returns the full string; call sites pin a stable
// prefix with a single slice (one idiom: slice at use, never inside).
function patternError4(source) {
  try {
    compileSearchPattern(source);
    return "NO-THROW";
  } catch (error) {
    return `${error.constructor.name}: ${String(error.message)}`;
  }
}

function runSuite4() {
  return JSON.stringify({
    patternSource: compileSearchPattern("bug").source,
    patternFlags: compileSearchPattern("bug").flags,
    errEmpty: patternError4("   "),
    errBadPrefix: patternError4("([").slice(0, 44),
    hitsBug: searchSession(SESSION4, "bug", { maxSearchHits: 50, maxRecallTokens: 16000 }),
    hitsRead: searchSession(SESSION4, "read", { maxSearchHits: 50, maxRecallTokens: 16000 }).hits.map((hit) => hit.seq),
    hitsTrace: searchSession(SESSION4, "trace", { maxSearchHits: 50, maxRecallTokens: 16000 }).hits.map((hit) => [hit.seq, hit.kind]),
    hitsNone: searchSession(SESSION4, "zzz-no-such-token", { maxSearchHits: 50, maxRecallTokens: 16000 }),
    capHits: searchSession(SESSION4, "e", { maxSearchHits: 1, maxRecallTokens: 16000 }),
    capBudget: searchSession(SESSION4, "e", { maxSearchHits: 50, maxRecallTokens: 20 }),
    manyLines: searchSession(SESSION4, "needle", { maxSearchHits: 50, maxRecallTokens: 16000 }).hits[0].text,
    consts: [DEFAULT_MAX_SEARCH_HITS, MAX_LINES_PER_HIT],
  });
}

const EXPECTED4 = JSON.stringify({
  patternSource: "bug",
  patternFlags: "iu",
  errEmpty: "InvalidSearchPatternError: invalid search pattern \"   \": pattern is empty",
  errBadPrefix: "InvalidSearchPatternError: invalid search pa",
  hitsBug: {
    pattern: "bug",
    totalMatches: 2,
    hits: [
      { seq: 1, kind: "user", text: "[seq 1: user]\n  1: please fix the login bug urgently" },
      { seq: 2, kind: "assistant", text: "[seq 2: assistant]\n  1: the bug is in auth.js, fixing now" },
    ],
    omitted: 0,
    truncated: false,
    tokens: 34,
    text: "[search \"bug\": 2 matching event(s)]\n\n[seq 1: user]\n  1: please fix the login bug urgently\n\n[seq 2: assistant]\n  1: the bug is in auth.js, fixing now\n\n[use recall with a (seq N) pointer to restore any hit's full original content]",
  },
  hitsRead: [3],
  hitsTrace: [[4, "tool/result"]],
  hitsNone: {
    pattern: "zzz-no-such-token",
    totalMatches: 0,
    hits: [],
    omitted: 0,
    truncated: false,
    tokens: 0,
    text: "[search \"zzz-no-such-token\": 0 matching event(s)]",
  },
  capHits: {
    pattern: "e",
    totalMatches: 7,
    hits: [{ seq: 0, kind: "session/start", text: "[seq 0: session/start]\n  1: [session/start]" }],
    omitted: 6,
    truncated: true,
    tokens: 15,
    text: "[search \"e\": 7 matching event(s)]\n\n[seq 0: session/start]\n  1: [session/start]\n\n[6 more matching event(s) omitted — narrow the pattern or use recall]\n\n[search budget exhausted; some hits were cut]\n\n[use recall with a (seq N) pointer to restore any hit's full original content]",
  },
  capBudget: {
    pattern: "e",
    totalMatches: 7,
    hits: [
      { seq: 0, kind: "session/start", text: "[seq 0: session/start]\n  1: [session/start]" },
      { seq: 1, kind: "user", text: "[seq 1: user...(truncated from search budget)" },
    ],
    omitted: 5,
    truncated: true,
    tokens: 29,
    text: "[search \"e\": 7 matching event(s)]\n\n[seq 0: session/start]\n  1: [session/start]\n\n[seq 1: user...(truncated from search budget)\n\n[5 more matching event(s) omitted — narrow the pattern or use recall]\n\n[search budget exhausted; some hits were cut]\n\n[use recall with a (seq N) pointer to restore any hit's full original content]",
  },
  manyLines: "[seq 6: assistant]\n  1: needle line number 0\n  2: needle line number 1\n  3: needle line number 2\n  4: needle line number 3\n  5: needle line number 4\n  6: needle line number 5\n  7: needle line number 6\n  8: needle line number 7\n  9: needle line number 8\n  10: needle line number 9\n  ...(5 more matching lines in this event)",
  consts: [50, 10],
});

const FIRST4 = runSuite4();
check("stage-4 vectors match original", FIRST4, EXPECTED4);
check("stage-4 deterministic double-run", runSuite4(), FIRST4);

if (failures > 0) {
  console.log(`selftest FAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log("selftest passed");
