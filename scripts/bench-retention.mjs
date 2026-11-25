/**
 * Retention gate behind future cut-policy changes.
 *
 * Synthetic mixed history (user text + assistant text + tool-call +
 * tool-result, ~585 payload chars/message) with planted unique probes in
 * the cut region through the real `compileCompaction` path, under two
 * configs: default (no cap expected — every must-keep probe must survive)
 * and a tight cap (error-diagnosis rows must survive whole via the
 * fail-open path; other categories are reported, not gated). The
 * post-cut context is reconstructed the way the host rebuilds it
 * (checkpoint + kept tail at/after keepID) and each probe is checked by
 * substring. Every rerun is asserted byte-identical (determinism), then
 * the markdown table rows are printed.
 *
 * Run: `node scripts/bench-retention.mjs` (exit 0 = pass, nonzero = fail).
 * No dependencies beyond `../adapter.mjs` and node builtins.
 */
import { buildConfig, compileCompaction } from "../adapter.mjs"

const MESSAGE_COUNT = 40
const CHARS_PER_MESSAGE = 585
const TIGHT_CAP_TOKENS = 800
// Probes plant only below this line; the kept tail (keepMessages 6)
// stays probe-free with margin, and the keepID-position assertion below
// fails the gate if a probe ever lands in the tail.
const PROBE_CUTOFF_INDEX = MESSAGE_COUNT - 10
const SENTENCE = "the failing test opens the session middleware and retries the request. "

const PROBES = [
  { category: "decision", gate: "always", text: "RET-PROBE-DECISION sessions use TTL 60 for the cache (probe D1)." },
  { category: "decision", gate: "always", text: "RET-PROBE-DECISION retry budget is three attempts per session (probe D2)." },
  { category: "file", gate: "always", text: "src/auth/RET-PROBE-FILE-session.js" },
  { category: "file", gate: "always", text: "src/middleware/RET-PROBE-FILE-timeout.js" },
  { category: "error", gate: "always", text: "RET-PROBE-ERROR ETIMEDOUT connecting to the session store (probe E1)." },
  { category: "error", gate: "always", text: "RET-PROBE-ERROR ELOOP too many symlinks resolving the cache dir (probe E2)." },
  { category: "correction", gate: "always", text: "RET-PROBE-CORRECTION the timeout is 60s, not 30s (probe C1)." },
]

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

function probeFor(index) {
  // Spread probes across the cut region (never the kept tail — tail
  // retention is verbatim by construction and proves nothing).
  if (index >= PROBE_CUTOFF_INDEX) return null
  const slot = index % 7
  return slot < PROBES.length ? PROBES[slot].text : null
}

function makeMessage(index) {
  const id = `m${index}`
  const kind = index % 5
  if (kind === 0) {
    const probe = probeFor(index)
    const message = { id, role: "user", content: [{ type: "text", text: "" }] }
    return fit(message, (text) => {
      message.content[0].text = text
    }, `[user ${index}] ${probe === null ? "please investigate the flaky session timeout. " : `${probe} `}`)
  }
  if (kind === 1) {
    const probe = probeFor(index)
    const message = { id, role: "assistant", content: [{ type: "text", text: "" }] }
    return fit(message, (text) => {
      message.content[0].text = text
    }, `[assistant ${index}] ${probe === null ? "on it, checking the session middleware first. " : `${probe} `}`)
  }
  if (kind === 2) {
    const probe = probeFor(index)
    const filePath = probe !== null && probe.includes("RET-PROBE-FILE") ? probe : `src/auth/session-${index}.js`
    const message = { id, role: "assistant", content: [{ type: "tool-call", id: `tc${index}`, name: "read", input: { file_path: filePath, note: "" } }] }
    return fit(message, (text) => {
      message.content[0].input.note = text
    }, `read chunk ${index}. ${probe !== null && !probe.includes("RET-PROBE-FILE") ? `${probe} ` : ""}`)
  }
  const probe = probeFor(index)
  if (kind === 3 && probe !== null && probe.includes("RET-PROBE-ERROR")) {
    return { id, role: "tool", content: [{ type: "tool-result", id: `tc${index}`, name: "read", result: { type: "error", value: probe } }] }
  }
  const message = { id, role: "tool", content: [{ type: "tool-result", id: `tc${index - 1}`, name: "read", result: { type: "text", value: "" } }] }
  return fit(message, (text) => {
    message.content[0].result.value = text
  }, `const TTL = 60; // seconds (result ${index}). `)
}

function buildHistory() {
  const messages = []
  for (let index = 0; index < MESSAGE_COUNT; index += 1) messages.push(makeMessage(index))
  return messages
}

function postCutContext(out, messages) {
  const at = messages.findIndex((message) => message.id === out.keepID)
  const tail = at === -1 ? [] : messages.slice(at)
  return `${out.checkpoint}\n${JSON.stringify(tail)}`
}

function compileDeterministic(messages, config, label) {
  const first = compileCompaction(messages, config)
  if (first === undefined) throw new Error(`${label} abstained (no keepID)`)
  const second = compileCompaction(messages, config)
  if (second === undefined || second.checkpoint !== first.checkpoint) {
    throw new Error(`${label} nondeterministic checkpoint across reruns`)
  }
  return first
}

const failures = []
function requireProbe(context, probe, label) {
  if (!context.includes(probe.text)) failures.push(`${label} lost ${probe.category} probe: ${probe.text.slice(0, 48)}…`)
}

// A probe is only planted if its text actually reached the built history,
// and only counts if it sits strictly before the kept tail: tail hits
// are verbatim by construction and must never satisfy the gate.
function plantedProbeIndices(messages, probe) {
  const indices = []
  messages.forEach((message, index) => {
    if (JSON.stringify(message).includes(probe.text)) indices.push(index)
  })
  return indices
}

function requireCutRegion(messages, out, label) {
  const keepAt = messages.findIndex((message) => message.id === out.keepID)
  if (keepAt === -1) {
    failures.push(`${label} keepID ${out.keepID} not found in history`)
    return
  }
  for (const probe of PROBES) {
    for (const planted of plantedProbeIndices(messages, probe)) {
      if (planted >= keepAt) {
        failures.push(`${label} probe in kept tail (index ${planted} >= keepID index ${keepAt}): ${probe.text.slice(0, 48)}…`)
      }
    }
  }
}

const messages = buildHistory()

const roomy = compileDeterministic(messages, buildConfig({}), "default config")
const roomyContext = postCutContext(roomy, messages)
requireCutRegion(messages, roomy, "default config")
const roomyPlanted = PROBES.filter((probe) => plantedProbeIndices(messages, probe).length > 0)
for (const probe of roomyPlanted) requireProbe(roomyContext, probe, "default config")
for (const probe of PROBES) {
  if (!roomyPlanted.includes(probe)) failures.push(`default config failed to plant ${probe.category} probe: ${probe.text.slice(0, 48)}…`)
}

const tight = compileDeterministic(messages, buildConfig({ maxTokens: TIGHT_CAP_TOKENS }), "tight-cap config")
const tightContext = postCutContext(tight, messages)
requireCutRegion(messages, tight, "tight-cap config")
const errorProbes = PROBES.filter((probe) => probe.category === "error")
for (const probe of errorProbes) requireProbe(tightContext, probe, "tight-cap config")
const tightKept = typeof tight.stats === "object" && tight.stats !== null ? tight.stats.keptErrorWhole : undefined
if (!(typeof tightKept === "number" && tightKept > 0)) {
  failures.push("tight-cap config never engaged the error fail-open path (keptErrorWhole <= 0)")
}

const categories = [...new Set(PROBES.map((probe) => probe.category))]
const rows = categories.map((category) => {
  const planted = roomyPlanted.filter((probe) => probe.category === category)
  return {
    category,
    planted: planted.length,
    roomy: planted.filter((probe) => roomyContext.includes(probe.text)).length,
    tight: planted.filter((probe) => tightContext.includes(probe.text)).length,
  }
})

console.log("Retention gate: planted probes in the cut region, post-cut context = checkpoint + kept tail.")
console.log(`History: ${messages.length} messages; tight cap: maxTokens=${TIGHT_CAP_TOKENS} (default ${buildConfig({}).maxTokens}).`)
console.log("")
console.log("| Probe category | Planted | Default retained | Tight-cap retained |")
console.log("| --- | --- | --- | --- |")
for (const row of rows) {
  console.log(`| ${row.category} | ${row.planted} | ${row.roomy} | ${row.tight} |`)
}
console.log("")
console.log(`Compression: input ${JSON.stringify(messages).length} chars -> default checkpoint ${roomy.checkpoint.length} chars, tight-cap checkpoint ${tight.checkpoint.length} chars.`)
console.log("Determinism: both configs recompiled byte-identical.")
console.log("")

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log("Retention gate: PASS (every must-keep probe survived; error fail-open engaged under cap).")
