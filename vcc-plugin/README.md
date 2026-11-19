# vcc-compaction — deterministic LLM-free compaction for OpenCode V2

**Your long session gets summarized by a model. The summary is invented
text — and the model then reasons from it as if it were fact.**

This plugin removes the model from that step. On every `compaction` hook
it compiles history with a deterministic region compiler and sets
`event.result`, so the host takes its `fromHook` short-circuit: the
summary persists verbatim, the tail rebuilds from `keepID`, and **no
model call is billed** on the compaction path — proven live on host
v2.3.2 (see `../docs/research/vcc-plugin-live-verdict.md`).

Port of [`dsh-compaction-vcc`](https://github.com/tingfeng-droid/dsh-compaction-vcc)
(MIT, itself a fork of `TsFreddie/dsh-compaction-instant`), written
directly against `@opencode/plugin/effect` (canonical runtime), so no
convert-to-Effect task ever arises. The VCC reference engine is vendored
byte-identical from `../compiler/` into `./engine/` (sync-enforced).
Version: `vcc-compaction@0.1.0`.

## How it works

The adapter (`adapter.mjs`, pure offline) maps the request messages to
compile nodes, runs the deterministic reference compiler, and sets:

```js
event.result = { summary, metadata: { keepID } }
```

`keepID` is the id of the first message the host must keep: the last
`keepMessages` request messages stay verbatim, everything older compiles
into the summary. When no message id exists at/after the keep cut, the
adapter abstains — `result` stays unset and the host falls back to model
compaction. Never a broken summary.

## Example

Seven messages (user request, assistant text + two tool calls, results,
follow-ups) compile to this — verbatim, the real output:

```text
This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.

<compacted-checkpoint>

RECALL: append-only log — nothing is lost. `recall` restores original content: type "seq", id "3-7"; "result", id "3"; "checkpoint", id "1" (`[checkpoint N]` = dropped). `search` finds by keyword.

[vcc-compaction vcc-compiler-debug-2: 7 messages -> 8 entries]

[user]
please fix the login bug — sessions expire after 60 seconds

[assistant]
on it, checking the session middleware first

* read "src/auth/session.js" (seq 2 -> result 3)

[tool]
const TTL = 60; // seconds ...

[assistant]
* edit "src/auth/session.js" (seq 4 -> result 5)

[tool]
edited 1 file

[assistant]
fixed — TTL is now one hour. Want me to check the logout path too?

[user]
yes, and also verify refresh tokens still work

</compacted-checkpoint>
```

Every tool call is one line — `* name "key argument" (seq N -> result M)`.
The `-> result M` pointer keeps each result one lookup away. Long text is
truncated to its budget with a `...(truncated from seq N)` marker naming
the event that still holds the full content.

## Why keeping original tokens prevents hallucination

Ask a model to summarize history and it fills the details it cannot quite
recall with plausible-sounding wording — **and that filled-in material is
invented, not factual**. Worse, it reads fluently, and the model then treats
**its own summary as a factual premise**. A paraphrased number, a reworded
caveat, or a dropped precondition is enough to put a whole downstream chain
on a false footing.

This engine **only moves original text, never rewriting a single
character**: every elision carries a `(seq N)` pointer back to the original
event. So the model ever sees two things: **original tokens**, or **an
explicitly marked pointer saying content was elided here**. There is no
third kind. Pointer-based archiving costs a few bytes per elision,
essentially independent of history length — while a summary has to cover
more the longer the session gets, with more chances to rewrite and lose
information.

## Key features

- **LLM-free** — compaction never invokes a model. No summarizer prompt, no
  inference latency, no token spend; the compile is deterministic text
  processing.
- **Verbatim** — output contains only original tokens. Prior checkpoints
  are copied word for word instead of being re-summarized.
- **Deterministic** — the same messages + config always compile to the
  byte-identical summary (proven by double-run selftests).
- **Measured** — 7,500 mixed messages compile to a ~28k-character summary
  in ~0.8 s on the dev machine, byte-identical across runs.
- **Fail-safe** — no keepID, no result: the host falls back to model
  compaction rather than persisting a broken summary.

## Install

Not on npm yet — the first publish goes through CI once the `NPM_TOKEN`
secret exists (granular Read+write token, same recipe as
opencode-dev-framework). Until then, install from a clone.
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

The package is self-contained: the adapter imports the engine from
`./engine/` inside the package, so `vcc-plugin/` installs alone (path,
git, or npm tarball).

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

## Configuration

Options are the engine budgets plus behavior (all optional, upstream
defaults shown). Unknown keys are ignored; non-positive or non-finite
numbers fall back to defaults.

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

How the budgets behave:

- Every budget is enforced twice — by token count **and** by a
  `budget × 4` character ceiling (floor 32) — so pathological unbroken
  runs (base64 blobs, minified files) cannot bypass them.
- Tool calls are **always one line**: they are never rescaled. Truncation
  marks the cut with `...(truncated from seq N)`.
- Over-long tool results keep head and tail with an
  `...(elided from seq N)` middle, since the end (listings, logs) usually
  matters more than the middle.
- Under cap pressure the oldest **tool/result rows go first**
  (`[N tool/result entries elided: seqs a-b]`), then the oldest remaining
  entries — tool calls can never squeeze the dialogue out. The newest
  content always survives, and a `[cap enforced at N entry tokens]`
  footer says the cap bit.
- Dropped prior checkpoints never vanish silently: each leaves a
  `[checkpoint N]` line (N = compaction ordinal, 1 = oldest).
- `keepMessages` counts request messages, not entries: the host rebuilds
  the verbatim tail from `keepID`, the summary covers everything older.

## Seq pointers and recall

`(seq N)` ordinals are 1-based positions over the compacted messages, not
durable host ids — the hook only sees the request window. Every checkpoint
heads with a short RECALL guide telling the model how to recover elided
content; OpenCode-native recall tools (resolving message/part IDs against
the session log) are follow-up work, recorded in the plan. v1 ships the
engine: deterministic summary + keep-tail, with every cut marked and
pointing at its source.

## Message mapping

OpenCode parts map to compiler blocks as follows: text → text; reasoning
→ reasoning (elided unless `includeReasoning`); tool-call → one-liner
(`arguments: JSON.stringify(input)`, unparseable input falls back to
name-only); tool-result → single text block via projection (json →
compact `JSON.stringify`, text → as-is, error → `[error] ...`, content →
`TextContent` joined / `[file name]` / `[type]`); media → image iff
`mediaType` starts with `image/`, else document; `compaction` part with
text → synthesized checkpoint node (prior summaries carry over verbatim);
`compaction` with null text, `effort` parts, and system-role messages →
skipped.

## Tokenizer

Character-class heuristic, verbatim from upstream: ASCII letter runs and
digit runs count as one token each, punctuation is per-character,
whitespace is free, and CJK-density characters (CJK, kana, hangul, Thai,
Lao, Indic scripts) carry extra weight. Every cut lands on a code-point
boundary — emoji and astral characters always survive intact. ANSI escapes
and control bytes are stripped deterministically before counting.

## Layout

- `index.ts` — thin Effect wiring only (`Plugin.define` + `Effect.fn` +
  `session.hook`). No logic beyond config → `compileCompaction` → assign.
- `adapter.mjs` — pure mapping + compile (unit-tested, no host). See its
  header for the vocabulary mapping (tool args, tool-result projection,
  checkpoint synthesis, skip cases, tool-link seam).
- `engine/` — the VCC reference engine vendored byte-identical from
  `../compiler/` (`tokenize`, `compile`, `recall`, `session-compat`,
  `search`). Ships inside the npm tarball; fixes land in `../compiler/`
  first and are re-vendored, never hand-edited (enforced by
  `../scripts/check-engine-sync.mjs`).
- `selftest.mjs` — adapter unit vectors (`node vcc-plugin/selftest.mjs`).

## Verify

```sh
node --check vcc-plugin/index.ts
node vcc-plugin/selftest.mjs
node ../scripts/check-engine-sync.mjs
node ../compiler/selftest.mjs
```

Live compaction runs only with explicit approval + explicit `--model`,
from a scratch project, never a real one.

## Status and limits

- v1 ships the engine: deterministic summary + keep-tail. `(seq N)`
  pointers are ordinals over the compacted messages; OpenCode-native
  recall (message/part-ID resolution) is follow-up work.
- Multi-result tool messages link the first result id only
  (`message.toolCallId` carries one id); the rest still compile as text.
- `effect` comes from the host instance — declared as peer
  (`effect ^4.0.0`, `@opencode/plugin ^2.0.0`), never bundled.
- Engine source of truth is `../compiler/`; the `./engine/` copy is
  byte-identical (also recorded: the Object-form `package` registration
  above is how options reach the plugin).

MIT licensed — see `../LICENSE`.
