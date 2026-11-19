# Changelog

<!-- markdownlint-disable MD024 --><!-- repeated bucket headings -->

Generated from commit subjects (`scripts/changelog.sh`).
Single source: the tag-triggered workflow publishes each version's
section as the GitHub release notes, so this file and the release
page never diverge.

## [v0.1.0] - 2026-11-19

Shipped `vcc-compaction@0.1.0`: deterministic LLM-free compaction for
OpenCode V2 (Effect-direct hook + pure adapter), live-verified on host
v2.3.2 with no model call on the compaction path. See
`docs/research/vcc-plugin-live-verdict.md`.
