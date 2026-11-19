# Probe: compaction `result` override (the port decision)

## Hypothesis to kill or confirm

`session.hook("compaction", ...)` can set `event.result` to a **deterministic VCC-style compile** and the host will persist that text as the summary without calling any model. If true, VCC ports as a true LLM-free engine. If false (prior observation: history gets replaced by the note / compaction still runs), VCC ports only as trim + prompt-shaping, not as an engine.

## Setup

- Host: installed OpenCode V2 binary. Record `opencode --version`.
- Deps: `@opencode/plugin` version from probe lockfile (was 2.0.14 / host v2.0.22; re-verify on v2.2.0+).
- `probe-project/opencode.jsonc`: registers `../probe-plugin` only. Brain-free empty tree.
- `probe-plugin`: minimal `Plugin.define({ id: "vcc-probe", setup(ctx) { ... } })` with:
  - `ctx.session.hook("compaction", (event) => { ... })` logging full shape: keys of `event`, `system.length`, `messages.length`, message roles/IDs, `options`, whether `result` is settable.
  - Branch A: set `event.result = "<deterministic marker 12345>"` and log whether any model request followed (`model.request` hook + `session.step.ended` tokens).
  - Branch B (control): mutate `system` only, leave `messages` intact, observe post-compaction history shape on next request (expect: single user-role summary message whose ID equals inbox item).
- Results: append JSON lines to `probe-results/compaction-result-override.jsonl` with `{ ts, opencodeVersion, pluginVersion, branch, observation }`.

## Pass / fail

- PASS (portable engine): Branch A persists marker as the compaction summary, no LLM tokens billed for the compaction request, continued session works on marker + tail.
- FAIL (not an engine): marker replaces view history destructively, or compaction still calls the model, or tail is lost. Then VCC logic ports only into `context`-hook trim + `compaction`-hook system-prompt shaping per `operator-context-management/docs/spec.md`.

## Do not

- Depend on Operator Memory, touch `~/.operator/state/`, or write to any real project.
- Run against a window-filling session for threshold tests (still disproportionately expensive — see probes.md Phase 2 note).
