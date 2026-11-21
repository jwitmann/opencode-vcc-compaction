# Plan: VCC vs V2 compaction contenders (comparison + borrow list)

**Scope:** ground the hypothetical VCC vs DCP/magic-compact question in the
V2 reality: DCP + magic-compact peer the v1 SDK (`@opencode-ai/plugin`)
and cannot load on this host. The stageable fight is VCC vs the single
top contender, `compaction-model` (the only other V2 summary-writer).
No code changes in this doc; live runs need explicit approval +
explicit `--model` per `AGENTS.md`.

## Base

- Host `opencode v2.3.2`, `@opencode/plugin 2.3.2`, `effect 4.1.0`
  (re-resolved 2026-11-21 via `XDG_DATA_HOME=/tmp/opencode-xdg opencode
  --version` + `package-lock.json`).
- Ours `opencode-vcc-compaction@0.3.3` (Effect-direct `compaction` hook,
  deterministic region compiler, `event.result = { summary, metadata:
  { keepID } }`, snapshot + `/vcc-recall|search|status`).
- Top contender (npm registry, fetched 2026-11-21):
  `@madsoftwaredev/opencode-compaction-model@0.1.3` — V2
  (`@opencode/plugin ^2.0.12`). Dedicated summarizer model/variant on
  the `compaction` hook; validates headings, retries once, falls back
  to host compaction; stamps `metadata.compactionModel`; abstains for
  `claude-code`.
- Not contenders (no summary rivalry): `@cesarus777/opencode-cgp@0.6.0`
  and `@esuyo/esuyo-opencode-compaction@1.0.0` govern trigger policy,
  not summary content; `@madsoftwaredev/opencode-compaction-fold@0.1.2`
  is display-layer. Any co-install check rides along inside the pilot
  session, not as its own harness.
  - v1 (not stageable same-host): `@tarquinen/opencode-dcp@3.2.1`
    (local clone 3.1.15), `magic-compact@1.2.2` — both peer
    `@opencode-ai/plugin` (v1 SDK).
- Read, not stageable (different host): `Tranquillitatis-Lab/dsh-live-compact@1.1.12`
  README (fetched 2026-11-21) — the DSH original behind
  `opencode-live-compact`: per-turn in-place shaving on native DSH
  per-turn hooks, backup-before-cut, own `spine-checkpoint` cards.
  Borrow list below; see `docs/research/vcc-livecompact-pilot.md` for
  why the OpenCode port never engaged headless.

## The fight

**VCC vs compaction-model** — same hook, opposite philosophy (verbatim
text with pointers and zero inference vs dedicated-model summaries).
Decider is the needle test + hallucination audit + billed usage (our rows carry
no usage fields; theirs must bill the summarizer).

## Method (when approved)

Same probe pattern as `compaction-probe-verdict.md`: one scratch
harness per side under `examples/`-style dirs, frozen scripted
histories (task-shaped, tool calls + results + planted needles),
version-tagged runs, frozen evidence, verdict in `docs/research/`.
Metrics per side: context tax, needle recovery rate, continuation
success, billed usage (usage-field presence), determinism double-run
(VCC only entrant), hook latency. No window-filling runs without
explicit approval.

## Borrowable ideas (fit / skip)

Fit (small, ours to take without changing philosophy):

- Explicit summary metadata (à la `compactionModel`): stamp engine rev
  and config hash in `metadata` beside `keepID` — cheap diagnostics.
- Invalid-summary discipline: validate headings, retry once, never
  install invalid, log reason without transcripts (their log hygiene).
- Status-without-context (à la esuyo toast): keep `/vcc-status` read
  paths RPC-quiet — already aligned, hold the line.
- Checkpoint-degradation audit (à la live-compact `spine-checkpoint`):
  they dodge host `<compacted-summary>`/`compact-checkpoint` nodes
  because the host re-summarizes them (summary-of-summary shrinkage).
  Audit whether successive compactions degrade our checkpoint the same
  way — check what `session-compat.mjs` already does with our own prior
  markers, add a selftest vector if uncovered.

Park (needs owner decision / new surface — do not expand scope here):

- Per-session on/off switch (esuyo `/compaction on|off`, DCP `/dcp manual
  [on|off]` — persisted per-session, feedback via ignored message): would
  need a new command or storage flag. Parked.
- Provider-specific abstain (their `claude-code` carve-out — note:
  `claude-code` is a provider *inside* OpenCode, typically the
  subscription/plan route via the `@openchamber/opencode-claude` bridge,
  with its own session/compaction bookkeeping): check whether any V2
  provider route bypasses `event.result` the way their bridge does.
  Parked as investigation.
- Asymmetric cut policy (live-compact pointer rule): giant successful
  tool results → pointers, failures keep exit code + full diagnostics
  (skip the cut if diagnostics don't fit the budget). Translation sketch
  for our pipeline (current: every `role: "tool"` result gets the same
  `excerptToolResult(body, toolResultExcerptTokens)` head/tail cut,
  `engine/compile.mjs:685`): (1) classify at the adapter on the
  structured `type: "error"` signal and thread a per-block failure flag
  to the compiler — never re-derive from the "[error] " text prefix;
  (2) split the budget (`toolResultExcerptTokens` for successes, new
  larger `toolErrorExcerptTokens` for failures, optional pointer-only
  threshold for huge successes), defaults byte-identical to today;
  (3) the doesn't-fit path fails OPEN for errors (keep whole + stats
  flag + warn, never abstain the whole compaction to save one stack
  trace). Rationale: successes are replaceable (snapshot holds the
  original one `recall` away), failures are not. Would change compiler
  behavior. Parked.
- Prefix-cache-aware cut floor (live-compact newest-card floor): never
  cut left of the newest card, never rewrite cached prefix. Optimizes
  cache survival, not just tokens; needs host cache-behavior grounding.
  Nuance: their floor fits per-turn shaving (stable cached front);
  checkpoint-at-fire puts a fresh summary at the front and busts prefix
  cache by construction, so a direct port would be cargo-culting. The
  version that fits us: our compiler is deterministic, so identical
  windows yield byte-identical summaries — retries/branches/recompiles
  of unchanged history are cache-friendly for free, where model-written
  summaries never are. Parked.

## Standing list (the whole board)

- Green-light anytime (pure engineering, no live run): metadata stamping,
  validate-before-install, checkpoint-degradation audit.
- Awaiting owner decision: per-session on/off switch, provider-abstain
  investigation, asymmetric cut policy, prefix-cache cut floor.
- Awaiting live-run approval: VCC vs compaction-model comparison
  (plus cgp/esuyo/fold co-install checks).

Skip (not ours):

- Per-turn in-place shaving (live-compact's core — needs a reliably
  firing per-turn seam; `experimental.idle` proved inert headless per
  `docs/research/vcc-livecompact-pilot.md`, and our per-turn needs are
  already served by the `context` hook).
- Dedicated summarizer model, per-agent policies, charts/dashboards,
  debounce/backoff (host owns the trigger), config-file watching (host
  owns our options), TUI tree-walking folds (complementary package —
  co-install instead).
