# docs

Durable project documents, organized by type (mirrors the
`opencode-dev-framework/docs` layout).

- `NOTES.md` — parking lot for side findings (dated headings, one line
  per finding, deleted on resolve). Empty is the healthy steady state.
- `research/` — verdicts grounding the release claims
  (`compaction-probe-verdict.md`, `vcc-plugin-live-verdict.md`) plus the
  `vcc-commands-plan.md` 0.2.0 plan. Each names its evidence (frozen JSONL
  lines under `archive/probe-results/`) and base versions.

Closed material lives frozen at the repo root under `archive/` (probe
harness + evidence, `PROBE.md`, `REUSE.md`, port plans) — not here.

Working contracts stay at the root on purpose (`AGENTS.md`, `README.md`
— the project entry points).
