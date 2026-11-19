# Notes

Parked side findings observed during other tasks. Triage and spin off
dedicated tasks as needed.

Format: append a one-line entry under a dated `## YYYY-MM-DD` heading —
`- [location] short description (found while: <task>)`. No analysis, no
proposed fixes, no questions in this file. When a finding is resolved,
delete its entry (no `FIXED:` annotations; this file holds open findings
only, so empty is the healthy steady state).

## 2026-11-19

- [vcc-plugin/snapshot.mjs searchSnapshot pad] seq-0 pad can consume a maxSearchHits/budget slot before the seq-0 filter drops it (found while: tripwire peer review).
