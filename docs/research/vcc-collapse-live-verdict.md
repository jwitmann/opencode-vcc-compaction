# Verdict: collapsed checkpoint emit live run (one-line summary + native window)

**Question:** does the new emit shape persist through the real host path
and replay intact — i.e. is the ~27 KB TUI wall actually gone while
context survives chained compactions?

**Answer: PASS.** Manual compaction on the live session persisted a
one-line summary (`compaction checkpoint: 10 messages -> 10 entries`),
the full checkpoint as the single-message `native.messages` window, and
`metadata` with `keepID` + `vccRev` + `vccConfigHash`. The model answered
a recall question from the replayed window, and a second manual
compaction carried the first window verbatim
(`second.contains(first) == true`).

## Base

- Host `opencode v2.3.2` (`opencode --version`, elevated run 2026-11-24),
  plugin `opencode-vcc-compaction@0.4.0` working tree at `0f00bfa` (emit)
  - `8a99012` (harness path), model
  `opencode-go/muse-spark-1.3-contributor` for all turns.
- Harness: `examples/opencode.jsonc` (`maxTokens 2000, keepMessages 4`);
  trigger was manual `POST /api/session/:id/compact` (host docs: works on
  short history), not the 99% buffer — tiny essays never approach the
  window on this model.
- Session `ses_vcc_emit_3`, scratch harbor-town essays with planted
  needles (Marisol / harbor bell at dawn / Brinehaven market).

## What happened

1. `POST .../ses_vcc_emit_3/compact` -> row `msg_20bc6d2e...`
   (`status completed`, `reason manual`): `summary` is exactly the
   one-line label (the TUI renders only this — one collapsed row);
   `native.messages` is one user message, 1982 chars, carrying the
   `<compacted-checkpoint>` tags and the Marisol needle, no `<details>`
   layer; `metadata.keepID` resolves to a real message.
2. Recall turn ("who is the lighthouse keeper and what rings at dawn?")
   answered correctly from the replayed window — context intact with no
   summary text in the row.
3. Second `POST .../compact` -> row `msg_20bc91aef...`
   (`3 messages -> 3 entries`, 2772-char window): still contains Marisol
   and the market content, and the full first window is a verbatim
   substring of the second — the `toNode` source-reattach path holds live.

## Not exercised live

- TUI row rendering itself ("Provider compaction" label, single row):
  headless probe, no TUI attached. Mechanistic proof is the store shape
  (summary is one line; the wall text lives only in `native.messages`)
  plus the already-read `CompactionMessage` code path (renders summary
  only). A TUI-attached eyeball check remains the only unproven step.
- Model-switch fallback (window replays per producing model): accepted
  degradation per the design note, not re-proven here.

## Probe-environment note (root cause fixed)

The shared background server resolves a relative plugin `package`
against its own cwd, not the config file (observed `..` ->
`/home/package.json` ENOENT, plugin silently absent, native compaction
fell back in `ses_vcc_emit_1`). Fixed by absolute path in
`examples/opencode.jsonc` (`8a99012`); doc-supported (absolute local
paths are explicit in the host plugin docs).
