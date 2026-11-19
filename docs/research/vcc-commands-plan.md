# Plan: vcc- commands for 0.2.0 (server-only)

**Scope (owner-locked 2026-11-19):** `/vcc-recall`, `/vcc-search`,
`/vcc-status` — all `vcc-` prefixed, all server-side only (no `./tui`).
Access strategy: spike first, don't assume hook-style events.

## Base

- Host `opencode v2.3.2` (`XDG_DATA_HOME=/tmp/opencode-data opencode
  --version` re-run 2026-11-19; stock run hits a log-permission error in
  this sandbox).
- Plugin API `@opencode/plugin 2.0.14` (re-resolved 2026-11-19 from
  `archive/probe-plugin/node_modules/@opencode/plugin/dist/effect/command.d.ts`
  and `session.d.ts`; matches the probe lockfile, not copied forward).
- Current package `opencode-vcc-compaction@0.1.0` is hook-only (no commands).

## Phase 0 finding: command ctx cannot read history (2.0.14)

- `CommandInvocation` is `{ sessionID, prompt, delivery }` only —
  `execute` gets no messages (`command.d.ts`).
- `Context.session` (`SessionDomain` in `session.d.ts`) is a pick:
  `create | get | switchAgent | switchModel | prompt | generate | command
  | synthetic | interrupt | update | move | wait | context` + `hook`.
  **No `message.list`, no `log`, no `message.get`.**
- The history APIs exist one layer down but unexposed: `SessionApi.log`
  (durable-event stream with `seq`), `message.get`, `MessageApi.list`
  (`sessionID, limit, order, cursor`) — confirmed in
  `@opencode/client/dist/effect/api/api.d.ts`.
- `RpcApi` is just `call` (plugin-defined RPC, not a host-API passthrough)
  — not a history door.
- Output plumbing exists: `prompt | command | synthetic` are in the pick,
  so the `/df-init` handoff pattern (execute → `session.prompt`) holds.
- `StorageDomain` (`get/set/remove/scan`) exists — viable snapshot store.
- `EventDomain` is just `subscribe` — not a history read.

## Consequence: snapshot-via-hook is the design

Hooks see history, commands don't. So a hook must persist a per-session
snapshot the commands read:

- Writers: `context` hook (`SessionContext` carries `messages`) and/or the
  existing `compaction` hook (already sees `messages`). Persist compact
  projection (ids, roles, seq ordinals, truncated text?) via `ctx.storage`
  keyed by session.
- Readers: `/vcc-recall` + `/vcc-search` resolve against the snapshot, not
  the live log. Staleness rule needed (snapshot written on every context
  hook = fresh enough; document the lag).
- This also settles `/vcc-status`: last-compaction stats live in the same
  snapshot (config + engine rev + last summary header/keepID). No second
  store.

Open seq-semantics risk (carried): the adapter uses 1-based ordinals over
*adapted* nodes (skips consume no seq); `recall`/`search` expect durable-log
seqs; `search.mjs` has the positional-scan quirk (`events[seq]` +
`seq === seq`). The snapshot writer must emit an event list satisfying
`session-compat` (`snapshotEvents/eventAt`) *and* the positional quirk, or
fix the quirk at adapter time (documented deviation, owner approval needed).

## Phases

1. **Snapshot writer:** `context` (and/or `compaction`) hook → `ctx.storage`
   per-session event list. Vectors prove `session-compat` reads it back.
2. **`/vcc-recall`:** `editor.add({ name: "vcc-recall", ... })`,
   `resolveRecallReference` over snapshot, `session.prompt` handoff with
   invocation delivery. Silent-on-nothing (log-only, `/df-update` pattern).
3. **`/vcc-search`:** `searchSession` over snapshot, `(seq N)` hits + recall CTA.
4. **`/vcc-status`:** config + engine rev + last-compaction line from snapshot.
5. **Verify + release:** `node --check`, both selftests, `check-engine-sync`,
   `markdownlint`, live run from `examples/` (explicit `--model` + version
   tags), README + CHANGELOG, `release.sh minor` → `0.2.0`.

## Try/catch + capability pattern (copy from guide)

- Wrap `ctx.command.transform` registration in try/warn-and-skip; probe via
  `ctx.command.list()`. Same fail-safe posture as the hook (never break the
  session when the command door is shut).
