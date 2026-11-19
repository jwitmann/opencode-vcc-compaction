# Plan: vcc TUI companion (quiet visible output)

**Scope (owner-approved 2026-11-19):** option (C) RPC event push.
File mirror dropped (unneeded: the event carries the session, so
TUI slash lookup — the hacky part — is gone too). TUI slash
commands dropped for the same reason; the companion is
listen-only. Slot widget deferred. Server commands stay only as
the silent trigger + fallback record. This lifts the 0.2.0
server-only lock.

## Why (settled 2026-11-19, not re-litigated here)

Server side cannot emit immediately-visible output: `execute` returns
`Effect<void>`; `prompt`/`synthetic` only admit to the inbox and the
transcript renders on promotion, which needs a run (wake). `resume:
false` = pending + invisible. Full chain in
`.operator/guides/opencode-plugin-commands.md` ("Verdict" section).
ODF already runs this split: server writes `runtime-status.json` per
project, `./tui` reads it and renders via `ctx.ui.dialog` — no wake.

## Base

- Host `opencode v2.3.x` (local source `~/opencode` v2.3.0; live
  behavior proven on v2.3.2).
- Plugin API `@opencode/plugin ^2.0.0`, Effect `^4.0.0`.
- Package `opencode-vcc-compaction@0.2.0` (server-only). Companion =
  new feature → `0.3.0` (minor).
- ODF precedent: `tui.tsx` (`@opentui/solid` jsx, `Plugin.define`
  from `@opencode/plugin/tui`, `ctx.keymap.layer` global commands
  with `slash: { name }`, `run` → `ctx.ui.dialog.alert` +
  `set({ size: "large", centered: true })` for long content);
  `./tui` export + `files` entry + own `tsconfig.tui.json`.

## Bridge options (server snapshot → TUI)

Server snapshot lives in `ctx.storage` (`vcc-snapshot/<sessionID>`);
TUI cannot reach it. Two options:

- **(A) File mirror (ODF pattern, recommended):** hook also writes
  the snapshot JSON to a project-local file; TUI reads the file for
  the current session. Proven, no new API surface. Costs: second
  writer to keep in sync, per-session file hygiene (pruning rule
  needed), path must resolve from `ctx.location.directory`.
- **(B) RPC part:** new `./rpc` export; TUI command calls the server,
  server reads `ctx.storage` and returns. No files, no extra
  staleness. Costs: new export surface + RPC wiring, live-proven
  from scratch.
- **(C) RPC event push (new favorite, 2026-11-19):** server defines
  `./rpc` with an event (e.g. `vcc.reply {sessionID, command,
  text}`); each `/vcc-*` execute computes the reply, `emit`s it,
  and returns void with NO prompt call — no wake, no chatter, no
  inbox row. TUI `ctx.data.listen` filters the `rpc.<id>.reply`
  type and renders toast/dialog. No files/pruning, and the
  session-resolution gap VANISHES (the event carries the session;
  toasts are global anyway). Costs: new export surface; TUI must
  be connected or the reply goes nowhere (non-TUI clients get
  silence — real degradation tradeoff vs chatter); delivery to
  `listen` needed one live proof run — done 2026-11-19: owner saw a
  `/vcc-*` reply render as a TUI dialog. Bridge proven end to end.

## Upstream context (checked 2026-11-19)

- #43132 (open, +18): "Plugin UI surface for the web/desktop app" —
  asks for client-side slash commands with `run(input)` before
  prompt submission: "this alone unlocks model-free plugin
  commands." Same enabling shape the TUI already has.
- #60585 (open): plugin `toast.show` already accepts `sessionID`
  and the bridge turns it into an "Open session" action — toasts
  are session-aware by design; the missing piece is only that TUI
  `run` is never told WHICH session invoked it.
- No existing issue asks for invocation context (sessionID) in TUI
  `run`. Filing that upstream is the non-hack fix; draft body
  available on request (evidence: `run(input?)` signature,
  `slash.command.run(slash.input)` dispatch, no focused-session
  accessor in TUI `Context`).

## Phases

1. **Bridge:** (A) file-mirror writer in the hook (+ pruning rule) or
   (B) `./rpc` contract + server implementation. Vectors prove the
   TUI-side reader sees what the hook wrote.
2. **`tui.tsx`:** `vcc-recall` / `vcc-search` / `vcc-status` TUI
   commands (argument parsing reused from `snapshot.mjs` parsers);
   `dialog.alert` (large+centered) for recall/search/status text,
   `toast` only if a short-form status proves readable.
3. **Packaging:** `./tui` export, `files` entry, `@opentui/*` deps,
   `tsconfig.tui.json`, gate update (tui typecheck), README +
   CHANGELOG, `release.sh minor` → `0.3.0`.
4. **Verify + release:** `node --check`, both selftests,
   `check-engine-sync`, tui typecheck, `markdownlint`, live TUI run
   from `examples/` (explicit approval + explicit `--model`,
   version-tagged), then tag.

## Open questions for owner — all resolved 2026-11-19

1. Bridge: **(C) RPC event push** (file mirror + request/response
   RPC dropped).
2. TUI slash names: **moot — no TUI slash commands** (companion is
   listen-only; session gap gone with them).
3. Long recall output: **dialog** (toast < 300 chars, else
   large+centered `dialog.alert` — implemented in `tui.tsx`).
4. Session resolution (fact-found 2026-11-19): TUI `run` receives
   only the raw arg string — the host dispatches
   `slash.command.run(slash.input)` with no sessionID
   (`tui/src/component/prompt/index.tsx`), and the TUI ctx exposes
   `client`, `data.session.*`, `location`, `storage`, `ui` but NO
   current/focused session accessor (`@opencode/plugin/dist/tui/`).
   So a per-session file mirror needs a resolution rule: (i)
   latest-activity heuristic in the current project (simple,
   occasionally wrong session), (ii) dialog picker on ambiguity
   (robust, extra step only when multiple sessions share the
   project), or (iii) a session-view slot widget instead of slash
   commands (slot input is session-scoped; different UX).
   CONFIRMED 2026-11-19: `SlotMap` carries `{ sessionID: string }`
   for `session.composer.top`, `sidebar.content`, `sidebar.footer`
   (`@opencode/plugin/dist/tui/`) — the slot option is real and
   host-scoped, no lookup involved.
