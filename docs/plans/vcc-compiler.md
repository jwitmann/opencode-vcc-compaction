# Plan: VCC deterministic compiler (reference implementation)

**Objective:** port the LLM-free compile engine from
`dsh-compaction-vcc@0.7.4` (MIT, `src/compiler.js` + recall/search cores)
into this repo as a dependency-free reference module, adapted from DSH
message vocabulary to OpenCode hook vocabulary. The proven Branch A seam
(`event.result = { summary, metadata: { keepID } }`, see
`docs/research/compaction-probe-verdict.md`) is how the output plugs in —
this plan covers the compiler only, not the hook wiring.

**Source base:** npm `dsh-compaction-vcc@0.7.4` tarball (23 files;
`src/compiler.js` 1175 lines, `recall.js` 263, `search.js` 113,
`tool.js` 188, `region.js` 511). License MIT (keep attribution header
in each ported file).

## Module map (port / adapt / drop)

- `compiler/tokenize.mjs` — PORT verbatim: `TOKEN_RE`, surrogate-safe
  slice guards, `tokenize`, `isCjkChar` density classes, `countTokens`,
  DeepSeek-weight estimator (kept as the conservative ceiling; real
  usage anchors to `session.step.ended` per REUSE.md, not this plan),
  plus `sanitize` and `truncateTokens`/`tailTokens` (budget primitives
  live with the tokenizer; `compile.mjs` imports them, never re-defines).
  Semicolons kept verbatim from upstream (see module header) — port
  fidelity beats repo formatting idiom here.
- `compiler/compile.mjs` — PORT with vocabulary swap: noise-strip,
  tool one-liners
  (`toolKeyFields`, `toolArgTools` whitelist, name-only fallback,
  `hideTools`), `excerptToolResult`, `compileNodes`/`compileRegion`
  (cap-loop, drop-oldest-tool-rows-first, floor 32), `joinCompiledEntries`,
  `frameCheckpoint`, `RECALL_GUIDE`. Input stays `CompileNode[]`
  (`{ seq, message: { role, content, source } | null }`); the OpenCode
  adapter (hook `Message` + `SessionMessage.ID` → nodes) is the seam,
  built after the core proves deterministic.
- `compiler/recall.mjs` — PORT: `parseSeqSpec` (`12`, `3-7`, `seq 12`,
  `seqs 12-34`), log expansion, `recallSession` with `maxRecallTokens`
  (16000) + provenance markers; checkpoint-ordinal elision lines.
- `compiler/session-compat.mjs` — PORT (implied dependency, not a stage):
  `sessionEventAt`/`sessionEvents`, accessor pair with legacy `events`-array
  fallback, duck-typed so the adapter supplies the session-shaped value.
- `compiler/search.mjs` — PORT: `compileSearchPattern`,
  `searchSession` with `maxSearchHits` (50), `MAX_LINES_PER_HIT` (10).
- DROP here (DSH-harness, not engine): `region.js` (session-state
  machinery → host `compact()` + hook, at handoff), `tool.js` cordis
  wiring, `command`/`preset-check`/`shadow-check`, `index.js` engine
  assembly. `elideCheckpointInjectedBodies` is carried
  verbatim inside `compile.mjs` (deleting it would fork `compileNodes`)
  but never enabled — the OpenCode preamble is per-request transient
  (REUSE.md reject); see the `compile.mjs` header.

## Acceptance

- Deterministic: same nodes + config → byte-identical entries (run twice,
  diff empty).
- Budgets hold: `checkpointCap` total cap, per-block budgets, `budget × 4`
  char ceiling; elision order tool/result/media/note before text.
- Pointers preserved: every truncation/elision keeps its `(seq N)` /
  `[checkpoint N]` pointer; no paraphrase anywhere (output substrings
  of input, plus fixed labels/markers).
- No model calls, no dependencies (node builtins only for the self-test
  runner; the modules import nothing beyond the sibling stage split,
  `compile.mjs` ← `tokenize.mjs`).

## Verification

- `node --check` on every new file (matches existing typecheck idiom).
- `compiler/selftest.mjs` (node, no framework): tokenizer vectors
  (CJK=1, ASCII-run=1, emoji surrogate-pair, code-point-safe truncation),
  budget-cap case (oversized region compiles under cap with tool rows
  dropped first), pointer case (every entry carries seq), determinism
  case (double-run diff). Fail-before proven by running vectors against
  a deliberately-broken stub first (recorded in review), pass-after on
  the port.
- Gate's `commands.test` untouched (evidence gate only); self-test runs
  manual and its output is quoted in the review. Wiring it into the gate
  is a follow-up decision, not this plan.

## Handoff (out of scope)

Reference module → `packages/core/src/context/` (or the consumer's chosen
home) per REUSE.md, with the hook adapter (`Message` → nodes,
`keepID` = first kept `SessionMessage.ID`). That move is a new task.
If the adapter ships as a plugin, write it against
`@opencode/plugin/effect` — the Effect implementation is the canonical
runtime and the Promise API (`Plugin.define` + `setup`, as used by our
throwaway probe) is its async/await-equivalent wrapper
(`packages/plugin/src/effect/PLAN.md:421`,
`packages/plugin/src/README.md:3` in the v2.3.2 checkout). The `compiler/`
modules are style-agnostic (pure offline functions) and work under either.
