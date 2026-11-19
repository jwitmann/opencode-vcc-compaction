# Plan: vcc-plugin — valid shippable OpenCode plugin (Effect-direct)

**End game** (owner-stated): a valid shippable plugin, not probe scaffolding.
Deterministic VCC compaction as the summary engine, wired through a
hook adapter written directly against `@opencode/plugin/effect`
(canonical runtime), so no convert-to-Effect task ever arises.

## Module map

- `vcc-plugin/adapter.mjs` — pure offline mapping + compile (no Effect
  import, no deps; unit-tested with node like `compiler/`):
  - `toNode(message, seq)` — `Message` (user/assistant/tool/system) →
    `CompileNode` (`{ seq, message: { role, content, source } | null }`).
    Part mapping: text → text; reasoning → reasoning (compiler elides
    unless `includeReasoning`); tool-call → one-liner source
    (`arguments: JSON.stringify(input)`, input is already parsed upstream);
    tool-result → single text block via `projectResultValue`
    (json → compact `JSON.stringify`, text → as-is, error → `String`,
    content → `TextContent.text` joined / `FileContent` → `[file name]`);
    media → image iff `media.mediaType` starts with `image/`, else document;
    compaction part with text → synthesized user node with
    `source: { kind: "compact-checkpoint" }` (compiler renders the
    `[system]` checkpoint entry); compaction part with null text,
    effort parts, and system-role messages → null (skipped, documented).
  - Tool-link seam: tool messages get `message.toolCallId` from the first
    tool-result part id (the compiler's pre-pass reads exactly that;
    OpenCode parts use `id`, not `toolCallId`). Multi-result messages link
    the first only — documented limitation, rest still compile as text.
  - `pickKeepID(messages, keepMessages)` — keepID = id of the first tailed
    message (scan forward past id-less messages); undefined when no id
    exists at/after the cut → hook leaves `result` unset and the host falls
    back to model compaction (fail-safe, never a broken summary).
  - `buildConfig(options)` — upstream defaults (`maxTokens` 8192,
    `textTokens` 8192, `userTextTokens` 16384, `toolCallTokens` 128,
    `toolResultExcerptTokens` 256, `includeReasoning` false, `hideTools` [],
    `noisePatterns` [] compiled via `compileNoisePatterns`); non-finite
    numbers fall back to defaults. Adapter always passes full config —
    `search`/`recall`/`compile` read budgets with no defaults.
  - `compileCompaction(messages, config)` — adapt → `compileRegion` →
    summary string (`frameCheckpoint` blocks joined: preamble, guide,
    header line, entries, footer on cap) + keepID. Deterministic.
- `vcc-plugin/index.ts` — thin Effect wiring only:
  `Plugin.define({ id: "vcc-compaction", effect: Effect.fn(...) })`,
  `yield* ctx.session.hook("compaction", (event) => Effect.sync(...))`
  setting `event.result = { summary, metadata: { keepID } }` or leaving it
  unset. No logic beyond config + call + assign.
- `vcc-plugin/selftest.mjs` — adapter unit vectors (node, no host, no
  model): every part type, tool-link pointer, checkpoint synthesis,
  skip cases, missing-id fallback, config defaults/overrides/invalid,
  summary shape + pointers, double-run determinism.
- `vcc-plugin/package.json` — `vcc-compaction@0.1.0`, `peerDependencies`
  (`effect ^4.0.0` per SDK README, `@opencode/plugin ^2.0.0`),
  `files: [index.ts, adapter.mjs]`. Engine stays in `../compiler`
  (relative import; path/git installs work; npm bundling is follow-up).
- `vcc-plugin/README.md` — install (path + `{package, options}` object
  form), config table, how it works, Effect note, status/limits
  (ordinal seqs — recall tools are follow-up; multi-result link limit).
- `demo-project/opencode.jsonc` — scratch project registering
  `../vcc-plugin` with options + `compaction.buffer 95%` for a cheap
  live trigger. Brain-free like `probe-project/` (never committed into
  real work; runs only with explicit approval + explicit `--model`).

## seq semantics (honest limitation)

Hook messages carry string IDs, not durable numeric seqs, so the adapter
assigns 1-based ordinals and the summary's `(seq N)` pointers are
positional. The OpenCode-native recall (`message`/part IDs + omitted
storage per REUSE.md) is a follow-up: either recall tools or pointer
translation. v1 ships the engine (deterministic summary + keep-tail),
not the recall loop.

## Acceptance

- Deterministic: same messages + config → byte-identical summary.
- keepID always resolves (`message.id === keepID` in the request) or the
  hook abstains (no result → host model path, never a broken summary).
- No model calls on the compaction path (live proof, same discriminator
  as the probe: `http.request kind=compaction` must not fire).
- Effect-direct: `effect` used from the host instance; declared as peer.
- No new runtime deps in this repo; unit tests run with node only.

## Verification

- `node --check vcc-plugin/index.ts` (extends the typecheck idiom).
- `node vcc-plugin/selftest.mjs` (fail-before on a broken stub first,
  recorded in review; pass-after on the adapter).
- `node scripts/verify-evidence.mjs` (gate untouched — no probe-results
  change in this task).
- Live run (gated): explicit user approval + explicit `--model`, cwd a
  scratch project registering the plugin, `compaction.buffer 95%`,
  verify the stored summary equals the adapter output and no
  `http.request kind=compaction` fires. Record versions per AGENTS.md.
