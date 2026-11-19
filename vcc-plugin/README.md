# vcc-compaction — deterministic LLM-free compaction for OpenCode V2

Valid shippable plugin (owner end game): the VCC reference engine from
`../compiler/` wired through a hook adapter written directly against
`@opencode/plugin/effect` (canonical runtime), so no convert-to-Effect
task ever arises. Version: `vcc-compaction@0.1.0`.

## How it works

On every `compaction` hook, the adapter (`adapter.mjs`, pure offline)
maps the request messages to compile nodes, runs the deterministic
reference compiler, and sets `event.result`:

```js
event.result = { summary, metadata: { keepID } }
```

The host takes its `fromHook` short-circuit: the summary persists verbatim
as the compaction summary, the tail rebuilds from `keepID`, and **no model
call is billed** on the compaction path (proven by the throwaway probe in
`../probe-results/` + `../docs/research/compaction-probe-verdict.md`).

When the adapter cannot pick a `keepID` (no message id at/after the keep
cut), it abstains — `result` stays unset and the host falls back to model
compaction. Never a broken summary.

## Install

Not on npm yet — install from a clone (npm publish is blocked on
bundling `../compiler/*` into this package; see Status and limits).
Clone `https://github.com/jwitmann/opencode-vcc-compaction` and
register the local path:

```jsonc
// opencode.jsonc
{
  "plugins": [
    {
      "package": "/abs/path/to/opencode-vcc-compaction/vcc-plugin",
      "options": { "maxTokens": 8192, "keepMessages": 6 },
    },
  ],
}
```

Because the adapter imports the engine via the relative path
`../compiler/*`, the plugin must be installed as this directory inside
a full repo checkout — copying `vcc-plugin/` out alone will break.

Optional `opencode.jsonc` addition — auto-compaction threshold:

```jsonc
{
  // Fire auto-compaction once history passes (window − buffer).
  // "99%" (fire at ~1% of window) is the demo-harness trigger for cheap
  // live runs (see ../demo-project/opencode.jsonc); the override mechanism
  // is threshold-independent, so leave the default in production.
  "compaction": { "buffer": "99%" },
}
```

Options are the engine budgets plus behavior (all optional, upstream
defaults shown — see `adapter.mjs` `DEFAULT_PLUGIN_CONFIG`):

| Key | Default | Meaning |
| --- | ------- | ------- |
| `maxTokens` | 8192 | total cap on compiled entry tokens |
| `textTokens` | 8192 | per-block assistant text budget |
| `userTextTokens` | 16384 | per-block user text budget |
| `toolCallTokens` | 128 | tool one-liner budget |
| `toolResultExcerptTokens` | 256 | tool-result excerpt budget |
| `includeReasoning` | false | keep reasoning blocks (else elided) |
| `hideTools` | [] | tool names dropped entirely |
| `noisePatterns` | [] | extra strip regex sources (strings) |
| `keepMessages` | 6 | trailing messages kept verbatim |

`noisePatterns` entries must be valid regex sources — an invalid one
throws loudly at setup, never a silent no-strip.

## Layout

- `index.ts` — thin Effect wiring only (`Plugin.define` + `Effect.fn` +
  `session.hook`). No logic beyond config → `compileCompaction` → assign.
- `adapter.mjs` — pure mapping + compile (unit-tested, no host). See its
  header for the vocabulary mapping (tool args, tool-result projection,
  checkpoint synthesis, skip cases, tool-link seam).
- `selftest.mjs` — adapter unit vectors (`node vcc-plugin/selftest.mjs`).

## Status and limits

- v1 ships the engine: deterministic summary + keep-tail. `(seq N)`
  pointers are 1-based ordinals over the compacted messages; OpenCode-native
  recall (message/part-ID resolution) is follow-up work.
- Multi-result tool messages link the first result id only
  (`message.toolCallId` carries one id); the rest still compile as text.
- `effect` comes from the host instance — declared as peer
  (`effect ^4.0.0`, `@opencode/plugin ^2.0.0`), never bundled.
- Engine import is relative (`../compiler/*`): path/git installs work as
  a directory plugin; bundling to a single file for npm publish is
  follow-up (also recorded: the Object-form `package` registration above
  is how options reach the plugin).
