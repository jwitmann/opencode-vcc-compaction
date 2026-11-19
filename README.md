# vcc-port — dsh-compaction-vcc → OpenCode investigation

Question: can [tingfeng-droid/dsh-compaction-vcc](https://github.com/tingfeng-droid/dsh-compaction-vcc) (LLM-free deterministic compaction for DSH, MIT, fork of TsFreddie/dsh-compaction-instant) be ported to OpenCode V2?

This folder is a **disposable probe workspace**. It is not part of `operator-memory` and must never be committed there (`feat/context-management` stays `feat(core)` + `feat(opencode-v2)` only).

## Layout

- `probe-plugin/` — throwaway OpenCode V2 plugin that observes the live API. Must not depend on Operator Memory.
- `probe-project/` — scratch Brain-free project the probe runs against (own `opencode.jsonc` registering `../probe-plugin`).
- `probe-results/` — JSONL observations, one file per probe. Evidence for resolutions.
- `vendor/` — reference checkout notes / tgz of `dsh-compaction-vcc` for offline reading. Do not `npm install` DSH host deps here.
- `PROBE.md` — the one probe that decides everything (compaction `result` override).
- `REUSE.md` — what to lift verbatim vs. mechanism-swap.

## How to use (next session)

1. Start a **new session** with cwd `/tmp/opencode/vcc-port` (not `/home/jerome/operator-memory`).
2. Read `PROBE.md`, then `REUSE.md`.
3. Record `opencode --version` + resolved `@opencode/plugin` version with every result.
4. Resolutions go to `/home/jerome/operator-context-management/docs/open-questions.md` → `spec.md` / `decisions.md` per `docs/probes.md` Phase 3.

## Background already established (2026-11-19, lead session)

- OpenCode V2 has no `ctx.compaction` seam. Compaction = `ctx.session.compact()` + `session.hook("compaction")` shaping `system` only; host replaces history with one `user`-role summary message. `context` hook does not re-enter for compaction requests.
- Prior verdict on this base (probes.md Phase 2 + impl verification): setting `result` in the compaction hook **replaces history with the note instead of skipping compaction** — rejected once. Re-probe on current host before trusting it.
- Operator `contextManagement` already implements the VCC *pattern* (trim → omission notice + disk store → `operator:read_omitted` → receipt). VCC would be a stronger `compact` strategy inside that shell.
- DSH-specific bits that do NOT port: isolate realms, alias-masquerade install, `cordis.patch.yml`, `tokenMeter` singleton, `compaction/summary {provider}` event, `elideCheckpointInjectedBodies` + `dsh-tingfeng` `source.kind` (preamble here re-renders fresh, never a log node).
