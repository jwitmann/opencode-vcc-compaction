# Verdict: vcc-plugin live run (Effect-direct deterministic compaction)

**Question** (`docs/plans/vcc-plugin.md`): does the shippable Effect-direct
plugin persist a deterministic VCC summary through the real host path —
`event.result = { summary, metadata: { keepID } }` → `fromHook`, no model
call, tail kept, session continues?

**Answer: PASS.** First auto-compaction on the live session persisted a
7275-char deterministic summary verbatim, `keepID` resolves to a real
message, the session continued on the next turn, and the row carries no
usage — the `fromHook` short-circuit, not a model call.

## Base

- Host `opencode v2.3.2` (`opencode --version` in the elevated run),
  plugin `vcc-compaction@0.1.0`, model
  `opencode-go/muse-spark-1.3-contributor` for all turns (same model as the
  Branch A/B probes). Effect version is host-provided (not recorded —
  declared as peer `^4.0.0`).
- Harness: `demo-project/opencode.jsonc` registers `../vcc-plugin` with
  `{ maxTokens: 2000, keepMessages: 4 }`; `compaction.buffer 99%`.
- Session `ses_vcc_live_2`, scratch essays to accumulate history.
- Raw evidence: `session_message` row `msg_1f2c8158b001Fi9i6CcUndI4BD`
  (`type: compaction`, `status: completed`, `reason: auto`); host log
  `~/.local/share/opencode/log/opencode.log`.

## What happened

Eight essay turns accumulated ~134KB of history without firing at
`buffer 95%` — the ceiling is 5% of the model window, so this model's
window is large (unknown exact size; mechanism is threshold-independent).
After lowering the demo harness to `buffer 99%` (ceiling 1%, same
mechanism, cheaper trigger), the next short turn compacted immediately.

## The persisted row proves the plugin path

- `summary` (7275 chars) opens with the checkpoint preamble, carries
  `<compacted-checkpoint>` tags, the `RECALL:` guide, and the header
  `[vcc-compaction vcc-compiler-debug-2: 17 messages -> 17 entries]` —
  a format no model summarizer can emit (it names our compiler revision).
- `metadata.keepID = msg_1f2a58bfa001h8A302WcdQOCcU` resolves to a real
  `assistant` message in the same session (tail kept verbatim beside the
  summary); the session answered the next turn (continuation works).
- The row has **no usage/tokens fields** — `fromHook` performs no stream
  and bills nothing (same code-path + store-state proof as the probe's
  Branch A verdict). A host-log grep for `kind=compaction` fires found
  zero entries (weak corroboration only — the log may not record kinds;
  the content + store + code-path argument is the proof).

## Not exercised live (covered elsewhere)

- `(seq N -> result M)` tool pointers: this history had no tool calls, so
  no pointer markers appear (only untruncated text entries, which carry
  none by design). The tool-link path is unit-proven
  (`vcc-plugin/selftest.mjs`: `* read "auth.js" (seq 2 -> result 3)`).
- Recall tools / pointer translation: follow-up work per the plan
  (pointers are 1-based ordinals here).
- npm bundling: `adapter.mjs` imports `../compiler/*` relatively — fine
  for path/git installs, follow-up for npm publish.
