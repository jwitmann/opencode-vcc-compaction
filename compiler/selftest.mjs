/**
 * Stage-1 self-test: tokenizer + budget primitives.
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

if (failures > 0) {
  console.log(`selftest FAILED: ${failures} case(s)`);
  process.exit(1);
}
console.log("selftest passed");
