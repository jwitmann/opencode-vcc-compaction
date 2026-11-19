# docs

Durable project documents, organized by type (mirrors the
`opencode-dev-framework/docs` layout: `user/`, `plans/`, `dev/`).

- `NOTES.md` — parking lot for side findings (dated headings, one line
  per finding, deleted on resolve). Empty is the healthy steady state.
- `research/` — investigation results: probe verdicts, ecosystem scans,
  static-verification notes. Each names its evidence
  (`probe-results/*.jsonl` lines) and base versions.
- `plans/` — execution plans for follow-up work (created on demand).
- `user/` — operator-facing notes: how to run a probe, read evidence
  (created on demand).
- `dev/` — contributor internals beyond `AGENTS.md` (created on demand).

Working contracts stay at the root on purpose: `AGENTS.md` (agent config),
`PROBE.md` / `REUSE.md` (the active probe spec, referenced by path from
`AGENTS.md` and the brain index), `README.md` (project entry point).
Promote a root file here only once its question is settled — e.g. this
folder's first document closes `PROBE.md`'s question.
