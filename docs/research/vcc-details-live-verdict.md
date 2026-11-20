# Verdict: collapsible checkpoint wrapper live run

**Question:** does the single-`<details>` checkpoint wrapper (`b8f8185`,
shipped in `0.3.1`) persist verbatim through the real host path, stay
exactly one layer across chained compactions, and keep the session going?

**Answer: PASS.**

## Base

- Host `opencode v2.3.2`, plugin `opencode-vcc-compaction@0.3.1`
  (`examples/` harness, `{ maxTokens: 2000, keepMessages: 4 }`,
  `compaction.buffer 99%`), model
  `opencode-go/muse-spark-1.3-contributor` for all turns.
- Session `ses_vcc_details_1`, scratch essay turns to accumulate history.
- Evidence: `session_message` rows in `~/.local/share/opencode/opencode.db`
  (`type: compaction`, `status: completed`, `reason: auto`), read 2026-11-20.

## What happened

Six auto-compactions persisted (seqs 41, 65, 101, 113, 149, 185).
Every row:

- opens with `<details>` + `<summary>compaction checkpoint: N messages
  -> M entries</summary>` and closes with exactly one `</details>`
  (`<details>` count == 1 in all six — chained compactions re-wrapping a
  prior wrapped checkpoint do **not** nest; unwrap-on-entry works in vivo);
- carries the `<compacted-checkpoint>` tags and the `RECALL:` guide;
- carries **no usage/tokens fields** — the `fromHook` short-circuit, not
  a model call;
- is followed by a continued session (assistant turns after each row).

## Notes

- `keepID` chains through prior compaction rows (the host keeps the tail,
  which may itself be a checkpoint); continuation is unaffected.
- Whether a given TUI client folds `<details>` is client rendering and was
  not asserted here — the invariant proven is single-layer verbatim
  persistence with intact re-parse.
