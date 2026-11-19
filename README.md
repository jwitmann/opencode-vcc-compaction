# opencode-vcc-compaction — deterministic LLM-free compaction for OpenCode V2

**Your long session gets summarized by a model. The summary is invented
text — and the model then reasons from it as if it were fact.**

This plugin removes the model from that step. Port of [`dsh-compaction-vcc`](https://github.com/tingfeng-droid/dsh-compaction-vcc) (MIT, itself a fork of `TsFreddie/dsh-compaction-instant`), written directly against `@opencode/plugin/effect`.

On every `compaction` hook the plugin compiles history with a deterministic region compiler and sets `event.result = { summary, metadata: { keepID } }`. The host takes its `fromHook` short-circuit: the summary persists verbatim, the tail rebuilds from `keepID`, and **no model call is billed** on the compaction path — proven live on host v2.3.2 (see `docs/research/vcc-plugin-live-verdict.md`).

Why verbatim: a model asked to summarize fills what it cannot quite recall with plausible wording — invented, fluent, and then treated as factual premise. This engine only moves original text, never rewriting a character: every elision carries a `(seq N)` pointer back to its source event. The model sees original tokens or explicitly marked pointers. Nothing else.

- **LLM-free** — no summarizer prompt, no inference latency, no token spend.
- **Verbatim** — prior checkpoints carried over word for word, never re-summarized.
- **Deterministic** — same messages + config → byte-identical summary.
- **Measured** — 7,500 mixed messages compile to a ~28k-character summary in ~0.8 s on the dev machine.
- **Fail-safe** — when no keepID can be picked, the hook abstains and the host falls back to model compaction. Never a broken summary.

Full manual (example output, config behavior, mapping, tokenizer): [`vcc-plugin/README.md`](vcc-plugin/README.md).

## Layout

- `vcc-plugin/` — the product: `vcc-compaction@0.1.0` (Effect-direct hook + pure adapter + vendored engine + unit tests). Start here: [`vcc-plugin/README.md`](vcc-plugin/README.md).
- `compiler/` — deterministic reference engine (stages 1–4, verbatim port, dependency-free). Source of truth; vendored byte-identical into `vcc-plugin/engine/` (sync-enforced).
- `.github/workflows/` — CI: typechecks, selftests, evidence gate, engine-sync, markdown lint; tag pushes publish to npm and cut GitHub releases.
- `probe-plugin/` + `probe-project/` + `probe-results/` — the throwaway probe that decided everything (Branch A/B live runs, committed JSONL evidence). History, not the foundation — do not extend.
- `docs/research/` — verdicts: [`compaction-probe-verdict.md`](docs/research/compaction-probe-verdict.md) (closes `PROBE.md`), [`vcc-plugin-live-verdict.md`](docs/research/vcc-plugin-live-verdict.md) (plugin live PASS).
- `docs/plans/` — build records for the compiler port and the plugin.
- `demo-project/` — scratch harness registering `../vcc-plugin` (never run from a real project).
- `docs/archive/` — the original probe spec (`PROBE.md`) and reuse inventory (`REUSE.md`): closed, kept as record.
- `AGENTS.md` — contributor contract for AI agents.

## Install

Not on npm yet (first publish goes through CI once the `NPM_TOKEN` secret exists). For now, clone and register the local path:

```jsonc
// opencode.jsonc
{
  "plugins": [
    {
      "package": "/abs/path/to/opencode-vcc-compaction/vcc-plugin",
      "options": { "maxTokens": 8192, "keepMessages": 6 },
    },
  ],
  // Optional: "compaction": { "buffer": "99%" } fires auto-compaction at
  // ~1% of window (demo-harness trigger; leave the default in production).
}
```

Full option table in [`vcc-plugin/README.md`](vcc-plugin/README.md).

## Verify

```sh
node --check probe-plugin/index.ts && node --check vcc-plugin/index.ts
node compiler/selftest.mjs
node vcc-plugin/selftest.mjs
node scripts/check-engine-sync.mjs
node scripts/verify-evidence.mjs
```

Live compaction runs only with explicit approval + explicit `--model`, from a scratch project, never a real one.

## Status and limits

- v1 ships the engine: deterministic summary + keep-tail. `(seq N)` pointers are 1-based ordinals over the compacted messages; OpenCode-native recall (message/part-ID resolution) is follow-up work.
- When the adapter cannot pick a `keepID` it abstains (`result` unset → host falls back to model compaction). Never a broken summary.
- `effect` comes from the host instance (peer `effect ^4.0.0`, `@opencode/plugin ^2.0.0`), never bundled.

## License

MIT — see [`LICENSE`](LICENSE).
