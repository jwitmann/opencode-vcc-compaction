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

## Standing list (the whole board)

- Green-light anytime (pure engineering, no live run): metadata stamping,
  validate-before-install.
- Awaiting owner decision: per-session on/off switch, provider-abstain
  investigation.
- Awaiting live-run approval: VCC vs compaction-model comparison
  (plus cgp/esuyo/fold co-install checks).

Skip (not ours):

- Dedicated summarizer model, per-agent policies, charts/dashboards,
  debounce/backoff (host owns the trigger), config-file watching (host
  owns our options), TUI tree-walking folds (complementary package —
  co-install instead).
