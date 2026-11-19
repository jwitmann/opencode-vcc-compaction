# Draft upstream issue: TUI plugin `run` needs invocation context

> DRAFT — not filed. Target: `anomalyco/opencode` issues.
> Evidence versions: host source `~/opencode` v2.3.0, plugin API
> `@opencode/plugin` 2.0.14 / 2.3.2, behavior proven live on v2.3.2.

## Title

`[FEATURE]: pass invocation session to TUI plugin slash run`

## Body

### What is missing

A TUI plugin slash command's `run` receives only the raw argument
string — it is never told which session invoked it:

```ts
readonly run: (input?: string, event?: KeyEvent) => void | false | Promise<void>;
```

(`@opencode/plugin/dist/tui/context.d.ts`, `KeymapCommand`)

The host dispatches with input only
(`packages/tui/src/component/prompt/index.tsx` —
`await slash.command.run(slash.input)`), and the TUI `Context`
exposes `client`, `data.session.*`, `location`, `storage`, `ui` but
no focused/current session accessor. So a plugin command that needs
per-session data (e.g. read that session's snapshot and toast it)
must guess the session with a heuristic — or ask the user with a
picker. The information exists (the user is looking at the
session); the host just doesn't hand it over.

### Why the host almost does it

`context.ui.toast.show()` already accepts a `sessionID`, and the
bridge turns it into an "Open session" action (see #60585). Toasts
are session-aware by design — plugins are expected to know the
session. Only the `run` invocation lacks it.

### Concrete case

`opencode-vcc-compaction` keeps a per-session snapshot (server
`ctx.storage`, written by hooks since command ctx can't read
history). Its `/vcc-status`, `/vcc-search`, `/vcc-recall` server
commands all work but wake the agent (a model turn narrates the
output), and `synthetic resume:false` stays invisible until the
next wake — server side cannot emit visible output without a run.
A TUI companion (read snapshot → toast/dialog, no model turn)
is the documented architecture, but file-mirror and RPC bridges
both stall on the same gap: which session's snapshot?

### Requested change

Either:

1. Pass invocation context to `run`, e.g.
   `run(input?, { sessionID })` (additive; existing signature
   keeps working); or
2. Expose the focused session (e.g. `data.session.current()`)
   so `run` can resolve it.

Related: #43132 (client-side slash commands as the model-free
path, open), #60585 (toast `sessionID`, open).

### Environment

- Host 2.3.x (source v2.3.0, behavior v2.3.2), `@opencode/plugin`
  2.x, Linux.
