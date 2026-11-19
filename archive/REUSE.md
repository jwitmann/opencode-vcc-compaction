# Reuse map: dsh-compaction-vcc → OpenCode

Source: `dsh-compaction-vcc@0.7.4` (npm), README + `src/compiler.js` (dependency-free) + recall/search cores.

## Lift verbatim (pure logic → `packages/core/src/context/` later, not here)

- Turn grouping, boundary-turn detection, trailing-assistantless exclusion, keep-tail slicing (`compact/plan.ts` analogue in VCC compiler).
- Tool one-liner rules: `toolKeyFields`, `toolArgTools` whitelist, name-only fallback, `hideTools` drop, never-rescaled tool rows, cap-loop shrinks text budgets only (floor 32).
- Budget enforcement: `checkpointCap` total cap, `textTokens` / `userTextTokens` per-block budgets, `budget × 4` char ceiling, drop-oldest-tool-rows-first then oldest-entries.
- Code-point-safe slicing (no split surrogate halves), char-class tokenizer (CJK=1, ASCII-run=1, emoji=surrogate-pair).
- Recall/search cores: `seq` spec parsing (`12`, `3-7`, `seq 12`, `seqs 3-7`), log expansion, `maxRecallTokens` (16000) + `maxSearchHits` (50) caps with provenance markers.

## Mechanism swap (DSH → OpenCode)

- `ctx.compaction` seam → `ctx.session.compact()` + `session.hook("compaction")` + `ctx.session.hook("context")` for trim. See PROBE.md.
- `(seq N)` / `result N` / `[checkpoint N]` over durable DSH log → message/part IDs + `ctx.storage` or `~/.operator/state/omitted/<sessionID>/<contentID>` + `operator:read_omitted` (existing Operator pattern).
- `tokenMeter` singleton → `gpt-tokenizer` estimate anchored on `session.step.ended.tokens` (input + cache read + cache write).
- `cordis.patch.yml` bundle + preset alias masquerade + `warnOnPresetTakeover` → plain `opencode.jsonc` `plugins` entry + `ctx.options` object form. No isolate problem on OpenCode.
- `elideCheckpointInjectedBodies` → drop. Operator preamble is per-request transient, never persisted history.

## Reject

- `dsh.client` settings card (already removed upstream in 0.2.0), stats dashboards, single-JSON omission cache.
- Any DSH host imports (`@deepseek-ai/*`, `cordis:*`). Probe plugin must stay host-only + `@opencode/plugin`.
