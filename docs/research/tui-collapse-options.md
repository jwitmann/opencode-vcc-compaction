# TUI collapse options for the compaction checkpoint

**Question:** what can the plugin emit so the OpenCode TUI renders the
compaction checkpoint collapsed instead of a 27 KB expanded wall?

**Answer:** no markup trick folds. The supported seam is
`result.native.messages`: a provider-format replacement window that replays
*instead of* `summary`, while the TUI renders only `summary` — and renders
no body at all when the summary is blank. Emit a blank (or one-line)
summary plus the full checkpoint as a one-message native window, and the
row collapses to its header with context preserved.

## Base

- Plugin `opencode-vcc-compaction@0.4.0`, `@opencode/plugin ^2.0.0`
  (local `node_modules`).
- Upstream `anomalyco/opencode@dev`, read 2026-11-24 (files below).
- Local host binary version query blocked by sandbox (log-file
  permission); prior live verdicts ran host v2.3.2.

## What the TUI does today

- `packages/tui/src/routes/session/index.tsx` (`CompactionMessage`):
  renders `message.summary` as Markdown unconditionally. The body is
  wrapped only in `<Show when={content()}>` where `content` is the
  trimmed summary — a blank summary renders the header row alone.
- `packages/tui/src/routes/session/message-parts.tsx` (`TextPart`,
  `ReasoningPart`): all prose goes through OpenTUI `<markdown>`.
  OpenTUI recognises `<details>` as an HTML block tag but does not
  fold it — the pasted session shows the tags as literal prose with
  the full body expanded.
- `packages/tui/src/util/collapse-tool-output.ts`: truncation exists
  only for tool output, not for compaction rows.
- Slot paths (`@opencode/plugin` `SlotMap`): `app`, `home.footer*`,
  `prompt.footer*`, `session.composer.top`, `session.panel`,
  `sidebar.*`. No slot covers transcript or compaction rows, so the
  `./tui` companion cannot hide or replace the row.

## Dead ends (with reason)

- `<details>` wrapper: parser-visible, renderer-ignored. Folds in DSH,
  expands in OpenCode TUI. Upstream renderer matter, not pluggable.
- Custom Markdown block renderer: keyed by code-block language only;
  the checkpoint is prose.
- `session.verbosity` grouping: compactions are message rows, never
  groups.
- Short summary alone: the summary *is* the replacement context
  (`to-llm-message.ts`: summary branch builds the
  `<conversation-checkpoint>` user message). Shortening it without a
  window loses context.

## The viable seam: `native.messages`

- Hook contract (`@opencode/plugin` `SessionCompactionResult`):
  `` `native.messages`, when set, must be a provider replacement
  window; it replays instead of `summary`. ``
- Host `packages/core/src/session/compaction.ts` (`fromHook`):
  hook-supplied `{ text, native, metadata }` passes through untouched.
- Host `packages/core/src/session/history.ts`: a completed compaction
  with `native.messages` replays the window (`NativeWindow =
  Schema.Array(Message)`); a malformed hook-supplied window is
  *skipped* (falls back to the earlier compaction), never session-fatal.
- Host `packages/core/src/session/runner/to-llm-message.ts`:
  compaction-with-window returns the decoded window directly; the
  summary branch is not used.
- TUI labels the row `Provider compaction` when `native.messages` is
  present — header only if the summary is blank.

A valid window can be minimal: `Message` ids are optional and user
content accepts plain text parts, so
`[{ role: "user", content: [{ type: "text", text: "<checkpoint>" }] }]`
decodes. The kept tail still arrives from post-compaction DB rows, so
the window need only carry the summarized part.

## Round-trip sketch (implemented 2026-11-24)

1. `compileCompaction` produces the full checkpoint text plus a one-line
   summary label (`compaction checkpoint: N messages -> M entries`).
2. `event.result = { summary, metadata: { keepID, vccRev,
   vccConfigHash }, native: { messages: [checkpoint user message] } }`.
3. Next hook call receives the replayed window as an ordinary user
   message; the adapter detects the compiler's own
   `<compacted-checkpoint>` tag pair and reattaches the checkpoint
   source, so the engine carries it verbatim instead of
   re-summarizing it. Old `<details>`-wrapped checkpoints still unwrap
   via the existing single-layer strip.
4. `metadata.keepID` stays set (harmless; `withRecentText` attaches
   `recent`, which the native path ignores).
5. Model switch: window replays only for the producing model
   (`replayable`); otherwise history falls back to the earlier
   compaction — same degradation as native provider compactions.

## Open verification (needs approval + explicit `--model`)

- Live probe in `examples/`: emit blank-summary + window, confirm the
  TUI row is one line and the session continues across two chained
  compactions with context intact.
- Confirm empty-string summary passes host store decode (schema
  allows `""`; no host-side non-empty check found).
- Decide blank summary (one header line) vs one-liner (header plus
  e.g. `compaction checkpoint: N messages -> M entries`); one-liner
  is friendlier in clients without compaction special-casing.
- Decided 2026-11-24: one-liner. Empty-string summaries risk host-store
  decode edge cases; the label keeps every client to a single row.
