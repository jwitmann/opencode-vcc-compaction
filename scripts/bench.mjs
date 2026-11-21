/**
 * Perf sweep behind the README Performance table.
 *
 * Synthetic mixed histories (user text + assistant text + tool-call +
 * tool-result, ~585 payload chars/message) through the real
 * `compileCompaction` path with the default config, best of 3 runs per
 * size. Single-threaded, no model, no network. Asserts every rerun is
 * byte-identical (determinism), then prints the markdown table rows.
 *
 * Run: `node scripts/bench.mjs` (exit 0 = pass, nonzero = fail).
 * No dependencies beyond `../adapter.mjs` and node builtins.
 */
import { cpus } from "node:os"
import { buildConfig, compileCompaction } from "../adapter.mjs"

const SIZES = [999, 4998, 9999, 24999]
const RUNS = 3
const CHARS_PER_MESSAGE = 585
const SENTENCE = "the failing test opens the session middleware and retries the request. "

function padTo(text, total) {
  if (text.length >= total) return text
  return text + SENTENCE.repeat(Math.ceil((total - text.length) / SENTENCE.length)).slice(0, total - text.length)
}

function fit(message, set, prefix) {
  set(prefix)
  const room = CHARS_PER_MESSAGE - JSON.stringify(message).length
  set(prefix + padTo("", Math.max(0, room)))
  return message
}

function makeMessage(index) {
  const id = `m${index}`
  const kind = index % 4
  if (kind === 0) {
    const message = { id, role: "user", content: [{ type: "text", text: "" }] }
    return fit(message, (text) => {
      message.content[0].text = text
    }, `[user ${index}] please investigate the flaky session timeout. `)
  }
  if (kind === 1) {
    const message = { id, role: "assistant", content: [{ type: "text", text: "" }] }
    return fit(message, (text) => {
      message.content[0].text = text
    }, `[assistant ${index}] on it, checking the session middleware first. `)
  }
  if (kind === 2) {
    const message = { id, role: "assistant", content: [{ type: "tool-call", id: `tc${index}`, name: "read", input: { file_path: `src/auth/session-${index}.js`, note: "" } }] }
    return fit(message, (text) => {
      message.content[0].input.note = text
    }, `read chunk ${index}. `)
  }
  const message = { id, role: "tool", content: [{ type: "tool-result", id: `tc${index - 1}`, name: "read", result: { type: "text", value: "" } }] }
  return fit(message, (text) => {
    message.content[0].result.value = text
  }, `const TTL = 60; // seconds (result ${index}). `)
}

function buildHistory(count) {
  const messages = []
  for (let index = 0; index < count; index += 1) messages.push(makeMessage(index))
  return messages
}

function bench(messages, config) {
  let first = null
  let best = Infinity
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now()
    const out = compileCompaction(messages, config)
    const ms = performance.now() - start
    if (out === undefined) throw new Error("bench history abstained (no keepID)")
    if (first === null) first = out.summary
    else if (out.summary !== first) throw new Error("nondeterministic summary across runs")
    if (ms < best) best = ms
  }
  return { ms: best, summary: first }
}

const config = buildConfig({})
const rows = []
for (const size of SIZES) {
  const messages = buildHistory(size)
  const input = JSON.stringify(messages).length
  const { ms, summary } = bench(messages, config)
  const time = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
  rows.push({ size, input, summary: summary.length, time })
}

const cpu = (() => {
  try {
    return cpus()[0]?.model?.trim() ?? "unknown cpu"
  } catch {
    return "unknown cpu"
  }
})()
console.log(`Single-threaded \`node\`, no model, no network. Measured on the dev machine`)
console.log(`(${cpu}, ${process.version}) with synthetic mixed histories (user text +`)
console.log(`assistant text + tool-call + tool-result, default config), best of ${RUNS} runs.`)
console.log(`Input sizes are request-payload characters with ÷4 token estimates:`)
console.log("")
console.log("| History | Input | Summary | Time |")
console.log("| --- | --- | --- | --- |")
for (const row of rows) {
  const size = row.size.toLocaleString("en-US")
  const chars = row.input >= 1000000 ? `~${(row.input / 1000000).toFixed(1)}M` : `~${Math.round(row.input / 1000)}k`
  const tokens = row.input >= 1000000 ? `~${(row.input / 4000000).toFixed(1)}M` : `~${Math.round(row.input / 4000)}k`
  console.log(`| ${size} messages | ${chars} chars (${tokens} tokens) | ${row.summary.toLocaleString("en-US")} chars | ${row.time} |`)
}
console.log("")
console.log("Determinism: every size recompiled byte-identical across all runs.")
