# AGENTS.md — opencode-vcc-compaction

Product repo for `opencode-vcc-compaction`: deterministic LLM-free
compaction for OpenCode V2 — port of
[tingfeng-droid/dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc)
(MIT), proven live on host v2.3.2 (see
`docs/research/vcc-plugin-live-verdict.md`). This is the product repo,
not the probe workspace: the closed probe harness is frozen under
`archive/` and is not maintained.

## Project layout

- `vcc-plugin/` — the npm package (`opencode-vcc-compaction@0.1.0`:
  Effect-direct hook + pure adapter + vendored `engine/`; run
  `node --check vcc-plugin/index.ts` and `node vcc-plugin/selftest.mjs`).
- `compiler/` — deterministic reference engine (stages 1–4, verbatim
  port, dependency-free; run `node compiler/selftest.mjs`). Source of
  truth; vendored byte-identical into `vcc-plugin/engine/`
  (sync-enforced, never hand-edit `engine/`).
- `examples/` — scratch project registering `../vcc-plugin` with a cheap
  `compaction.buffer` trigger. Brain-free; always run live probes with
  cwd here.
- `scripts/` — `release.sh` / `changelog.sh` (tag-triggered publish flow),
  `check-engine-sync.mjs` (vendoring gate).
- `docs/research/` — verdicts grounding the release claims.
- `archive/` — frozen history: the closed probe harness + JSONL evidence,
  the deciding spec (`PROBE.md`), the reuse inventory (`REUSE.md`), the
  port plans (`plans/`). Do not extend, do not edit.
- `docs/` — working documents (`research/` verdicts, `NOTES.md` parking
  lot). Root files stay the working contracts.

## Rules

### Do

- Keep `examples/` Brain-free: no `.operator/` inside it; run live probes
  with cwd `examples/`.
- Tag every live result with `opencodeVersion` + `pluginVersion`.
- Commit locally when a logical unit is complete and the gate passes.

### Don't

- **Never push to remote.** Pushing is a deliberate user action, never an agent action.
- Never run window-filling sessions for threshold tests without explicit user
  approval (disproportionately expensive).
- Never let anything under `archive/` back into the build (no imports, no
  runnable wiring, no dependency on Operator Memory).
- Act on side findings mid-task — park a one-liner in `docs/NOTES.md`
  (dated heading, no analysis), list parked notes in the final summary,
  delete the entry on resolve. The current task's scope does not expand.
- Commit review artifacts — findings live in gitignored `review.md` or
  parked in `docs/NOTES.md`; commits carry implementation, evidence,
  and docs only.

### Ask first

- Adding a dependency, renaming the package, or changing the checkpoint
  marker format (persisted in user summaries).
- Republishing history: editing anything under `archive/`, or rewording a
  `docs/research/` verdict beyond a dated correction note.
- Anything in Don't that the task seems to require.

## Verification

- `commands.typecheck`: `node --check vcc-plugin/index.ts`.
- `commands.test`: `node compiler/selftest.mjs` plus
  `node vcc-plugin/selftest.mjs`, plus
  `node scripts/check-engine-sync.mjs` for engine/adapter changes.
- Docs-only changes: `markdownlint-cli2` over the tree (config:
  `.markdownlint-cli2.jsonc`); a PASS before the last edit is stale.
- Live compaction runs only with explicit approval + explicit `--model`,
  from the scratch project, never a real one.
- Plan compliance: re-read this file before declaring a task done and
  confirm every requirement was met; fix gaps first. Gate enforcement is
  `require_review` plus the runnable gates — see `.dev-framework/hardening.md`.
