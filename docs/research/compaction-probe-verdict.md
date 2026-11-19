# Verdict: compaction `result` override (Branch A/B live probe)

**Question** (`PROBE.md`): can `session.hook("compaction")` set `event.result`
to a deterministic VCC-style summary the host persists **without calling any
model**? PASS = VCC ports as a true LLM-free engine.

**Answer: PASS.** Deterministic override persists verbatim with a working
keep-tail; the session continues on marker + tail.

## Base

- Host `opencode v2.3.2`, `@opencode/plugin 2.0.14` (probe `bun.lock`),
  model `opencode-go/muse-spark-1.3-contributor` for both live arms.
- Harness: `probe-project/opencode.jsonc` registers `../probe-plugin`;
  `compaction.buffer 95%` so auto-compaction fires at ~5% of window
  (threshold-independent mechanism, cheap trigger).
- Raw evidence: `probe-results/compaction-result-override.jsonl`
  (18 version-tagged lines: 3 static + 6 live A + 6 live B + 3
  CORRECTION/VERDICT). This document interprets; the JSONL decides.

## Branch A — override (session `ses_e0dfa98beffe2Vx6jS88rbEdI8`)

`event.result = { summary: "VCC-PROBE-MARKER-12345",
metadata: { keepID: <first message id> } }`, 3 auto-compactions:

- All 3 persisted the marker **verbatim** as the compaction summary in the
  session store (`session_message` rows, status completed) with the
  hook-supplied `keepID`.
- No model call on the compaction path: host `fromHook`
  (`packages/core/src/session/compaction.ts:873-885`) performs no stream
  and bills nothing (usage undefined); billed run steps are tool-calls/stop
  only.
- The session continued across all 3 compactions, finished its task
  (idle/succeeded), and answered a follow-up turn — marker + tail work.

## Branch B — control (session `ses_e0df508beffeL35okBor0p41ud`)

Result unset, system-only mutation: 2 auto-compactions persisted
model-template summaries (`## ...`), and `http.request kind=compaction`
fired per compaction — positive control validating the network
discriminator. Same host and threshold as A; only the override differs.

## Correction (recorded, not hidden)

The probe's first tripwire was miscalibrated: `model.request
kind=compaction` fires at request **construction** (`model-request.ts:361`,
inside `prepare()`) **before** `deliver()` checks `event.result`
(`compaction.ts:635`), so it fires on the short-circuit path too. Three
Branch A lines saying "model call NOT skipped" are wrong and are
superseded in-file by a CORRECTION line (append-only evidence: raw lines
kept). True discriminator is `http.request`, which only a real provider
stream reaches.

## What this unblocks / leaves open

- Unblocks: the VCC compiler port per `REUSE.md` (turn-grouping, budgets,
  keep-tail slicing) — the engine question is settled.
- Stays here: per owner decision 2026-11-19 this verdict lives in this
  repo's `docs/research/` and is NOT folded into
  `operator-context-management/docs/`.
- Not re-proven: an `http.request` negative on Branch A (the hook postdates
  the A run). No-call proof for A is code-path + store + billing, which is
  sufficient; re-running A solely for the negative is optional.
