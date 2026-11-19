# AGENTS.md — opencode-vcc-compaction

Context file for AI agents working on the VCC port investigation: can
[tingfeng-droid/dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc)
(LLM-free deterministic compaction for DSH, MIT) be ported to OpenCode V2?

## Restart protocol

1. Read `PROBE.md`, then `REUSE.md`.
2. Record `opencode --version` + resolved `@opencode/plugin` version with every result.
3. Resolutions live here: verdicts and durable findings go under
   `docs/research/` (per owner decision 2026-11-19, probe resolutions
   do NOT fold into `operator-context-management/docs/`).

## Project layout

- `PROBE.md` — the one probe that decides everything (compaction `result` override).
- `REUSE.md` — lift-verbatim vs. mechanism-swap vs. reject inventory.
- `probe-plugin/` — throwaway OpenCode V2 plugin (host-only + `@opencode/plugin`;
  must not depend on Operator Memory).
- `probe-project/` — scratch Brain-free project (own `opencode.jsonc` registering
  `../probe-plugin`). Always run probes with cwd here.
- `probe-results/` — JSONL observations, one file per probe. Committed evidence.
- `vendor/` — reference checkout notes for offline reading. Do not `npm install`
  DSH host deps here.

## Rules

### Do

- Keep `probe-project/` Brain-free: no `.operator/` inside it; run probes with
  cwd `probe-project/`.
- Tag every result with `opencodeVersion` + `pluginVersion`.
- Commit locally when a logical unit is complete and the gate passes.

### Don't

- **Never push to remote.** Pushing is a deliberate user action, never an agent action.
- Never run window-filling sessions for threshold tests without explicit user
  approval (disproportionately expensive — see `PROBE.md` Do-not).
- Never let `probe-plugin/` depend on Operator Memory or touch `~/.operator/state/`.
- Never commit this workspace into `operator-memory` (`feat/context-management`
  stays `feat(core)` + `feat(opencode-v2)` only, per `README.md`).
- Act on side findings mid-task — park a one-liner in `docs/NOTES.md`
  (dated heading, no analysis), list parked notes in the final summary,
  delete the entry on resolve. The current task's scope does not expand.
- Commit review artifacts — findings live in gitignored `review.md` or
  parked in `docs/NOTES.md`; commits carry implementation, evidence,
  and docs only.

### Ask first

- Adding a dependency, changing the evidence schema, or rewording
  `PROBE.md`'s deciding question.
- Anything in Don't that the task seems to require.

## Verification

- Plan compliance: re-read `PROBE.md`/`REUSE.md` before declaring a task
  done and confirm every requirement was met; fix gaps first.
- `commands.typecheck`: `node --check probe-plugin/index.ts && node --check vcc-plugin/index.ts`.
- `commands.test`: `node scripts/verify-evidence.mjs`
  (JSONC configs parse + every JSONL line version-tagged;
  proven fail-on-mutation 2026-11-19) plus `node compiler/selftest.mjs`
  and `node vcc-plugin/selftest.mjs` for engine/adapter changes.
- Evidence standard is `probe-results/*.jsonl` lines (versions on every line)
  plus static source refs (`file:line`). Gate enforcement is `require_review`
  plus the two runnable gates — see `.dev-framework/hardening.md`.
