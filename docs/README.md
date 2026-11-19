# docs

Durable project documents, organized by type (mirrors the
`opencode-dev-framework/docs` layout: `user/`, `plans/`, `dev/`).

- `NOTES.md` — parking lot for side findings (dated headings, one line
  per finding, deleted on resolve). Empty is the healthy steady state.
- `research/` — investigation results: probe verdicts, ecosystem scans,
  static-verification notes. Each names its evidence
  (`probe-results/*.jsonl` lines) and base versions.
- `archive/` — closed specs kept as record: the deciding probe question
  (`PROBE.md`) and the reuse inventory (`REUSE.md`).
- `plans/` — execution plans for follow-up work (created on demand).
- `user/` — operator-facing notes: how to run a probe, read evidence
  (created on demand).
- `dev/` — contributor internals beyond `AGENTS.md` (created on demand).

Working contracts stay at the root on purpose (`AGENTS.md`, `README.md`
— the project entry points). Settled specs live in `archive/`; the first
verdict document closes `archive/PROBE.md`'s question.
