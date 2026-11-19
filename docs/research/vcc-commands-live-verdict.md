# Verdict: vcc- commands live proof (0.2.0 code)

**Question** (`docs/research/vcc-commands-plan.md`): do the server-only
`/vcc-recall`, `/vcc-search`, `/vcc-status` commands work through the real
host path — snapshot-via-hook, storage read, reply posted into the session?

**Answer: PASS.** All three commands executed live and posted correct
replies into the session.

## Base

- Host `opencode v2.3.2`, plugin tree at `526f19a` (post Effect v4 fix;
  package version still `0.1.0`, 0.2.0 unreleased), model
  `kimi-code-plan-global/kimi-for-coding`.
- Harness: `examples/opencode.jsonc` registers `../vcc-plugin` with
  `{ maxTokens: 2000, keepMessages: 4 }`; `compaction.buffer 99%`.
- Session `ses_vcc_live_3` (fresh; `ses_vcc_live_1` collides with a stale
  DB row pointing at the removed `demo-project/` directory).

## What happened

- Trivial turn (`Reply with exactly: READY`) created the session; the
  context hook wrote snapshot v1 (3 messages).
- `/vcc-status` → `opencode-vcc-compaction (engine vcc-compiler-debug-2)`,
  config line, `snapshot: v1, 3 message(s), … written 44s ago`.
- `/vcc-search READY` → 3 matching events with `(seq N)` refs.
- `/vcc-recall seq 1` → exact original user text restored
  (`Reply with exactly: READY`, 12 tokens).

## Incident note (stale service module)

- Before the fix, commands returned `CommandNotFoundError` and no
  `vcc-snapshot/*` keys existed: every hook event died on host Effect v4
  (`catchAll` removed), so no snapshot was ever written.
- After the `catch`/`catchCause` fix, commands still failed until the
  background `opencode serve` (running since Nov 18, pre-fix module
  cached) was restarted; the fresh service registered the commands
  immediately. Restarting the service is required after plugin code
  changes — the host does not reload plugin modules on its own.
