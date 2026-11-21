# Design (DRAFT): asymmetric cut policy for tool results

**Status:** draft for owner review. No behavior change ships with this
doc — the only code delta is parity-lock vectors pinning today's
uniform cut (green before and after, until implementation deliberately
flips them). Rationale and borrow source: DSH `dsh-live-compact`
pointer rule (giant successes → pointers, failures keep diagnostics),
translation sketch in `docs/research/vcc-v2-comparison-plan.md`.

**Problem:** `engine/compile.mjs` gives every `role: "tool"` result the
same `toolResultExcerptTokens` head/tail cut (`excerptToolResult`,
`compile.mjs:685`). Successes (replaceable — the snapshot holds the
original one `recall` away) and failures (irreplaceable diagnostics)
are treated identically, and under cap pressure Phase A drops error
rows whole with the rest (`compileRegion`, oldest low-value first).

**Principle:** successes are replaceable, failures are not. Cut the
former harder, keep the latter whole, never abstain a compaction to
save one stack trace.

## Signal (adapter — structured, never text-derived)

- `toNode` (`adapter.mjs`) already inspects the raw `tool-result`
  part for `toolCallId`. Thread `isError: true` on the tool node the
  same way when **any** `tool-result` part has structured
  `result.type === "error"`. Absent otherwise (precedent: `toolCallId`
  and checkpoint `source` are set only when present, so success-node
  goldens stay byte-identical).
- Never re-derive from the "[error] " text prefix (precedent:
  `isElidableSource` matches structured `source.kind`, never text —
  a user quoting an error must not be mistaken for one).

## Compiler (budgets + elision)

1. `role: "tool"` branch: successes use `toolResultExcerptTokens`;
   error-flagged nodes use new `toolErrorExcerptTokens` (default =
   `toolResultExcerptTokens` default → byte-identical out of the box).
2. New `toolResultPointerTokens` threshold (default off): successes
   over it collapse to a pointer line (`-> result N` already exists
   via the call line; the entry keeps one line, body stays one
   `recall` away). Off by default → byte-identical.
3. Fail-open: Phase A (low-value elision) skips error-flagged result
   entries; they are exempt from Phase B oldest-first shifting too.
   Only the single-entry hard truncate may still cut one (last resort,
   stats-flagged). Stats: `keptErrorWhole`; adapter warns when it is
   nonzero (precedent: the abstain warn line).
4. Entry shape: keep `kind: "result"` (join behavior unchanged), add
   `error: true` on the entry object; Phase A condition becomes
   `LOW_VALUE_KINDS.has(kind) && !entry.error`.
5. Config plumbing follows the existing key pattern exactly:
   `DEFAULT_PLUGIN_CONFIG` default → `buildConfig` `num()` resolution
   → `compileNodes` effective budgets → `BUDGET_FLOORS` floor entry.
   `scaleBudgets` stays text-only (tool budgets untouched, as today).

## Evaluation ladder (from the owner discussion 2026-11-21)

- Rung 1 (veto): byte-identical defaults — full suites untouched +
  replay of recorded live spans (pilot9 checkpoint inputs) with
  default config. Any diff stops the work.
- Rung 2 (benefit): new vectors — giant success → pointer cut; giant
  error → kept whole + stats + warn; un-fittable error → whole
  compaction still installs (fail open). Sketches below; they fail on
  today's compiler by construction.
- Rung 3 (size): both compilers over a fixture corpus; success spans
  shrink, error retention equal-or-better; warn volume stays flat.
- Rung 4 (if ambiguous): small error-planted live leg, continuation +
  diagnostic recall scored.

Kill at any rung: byte-diff at defaults, any dropped error
diagnostic, any new abstain, any unresolvable pointer.

## Vector sketches (for the implementation commit, not this one)

```js
// adapter: structured flag, absent-on-success parity
toNode({ role: "tool",
  content: [{ type: "tool-result", id: "t1", name: "bash",
    result: { type: "error", value: "boom" } }] }, 3)
// → { seq: 3, message: { role: "tool",
//      content: [{ type: "text", text: "[error] boom" }],
//      toolCallId: "t1", isError: true } }

// compiler: split budgets
compileNodes([{ seq: 3, message: { role: "tool", isError: true,
    content: [{ type: "text", text: GIANT }] } }],
  buildConfig({ toolResultExcerptTokens: 8, toolErrorExcerptTokens: 1000 }))
// → error entry kept (near-)whole while a success node is cut to 8.

// fail-open: over-cap region, giant error + small successes, tiny maxTokens
compileRegion([successRow, giantErrorRow, successRow],
  buildConfig({ maxTokens: SMALL }))
// → success rows elided first; error row survives;
//    stats.keptErrorWhole === 1.
```
