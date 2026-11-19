# Changelog

<!-- markdownlint-disable MD024 --><!-- repeated bucket headings -->

Generated from conventional commits (`scripts/changelog.sh`).
Single source: CI publishes each version's section as the GitHub
release notes, so this file and the release page never diverge.

## [v0.1.0] - 2026-11-19

### Features

- Implement Branch A/B compaction probe hook ([`b021e91`](https://github.com/jwitmann/opencode-vcc-compaction/commit/b021e9135e34e4ec5bb7bffa04648fc8f231f5b9))
- Live Branch A/B runtime probe: PASS (marker persisted, keepID tail works) ([`37e74f0`](https://github.com/jwitmann/opencode-vcc-compaction/commit/37e74f0805b4431a0ea06f3f19850fc1a3d2af1f))
- Compiler stage 1: tokenizer + budget primitives (verbatim port, self-tested) ([`ef01b9b`](https://github.com/jwitmann/opencode-vcc-compaction/commit/ef01b9b857a032611abf62321584b92b778d30d1))
- Compiler stage 2: region compiler (verbatim port, self-tested) ([`69eb127`](https://github.com/jwitmann/opencode-vcc-compaction/commit/69eb127671a8ac7f94dbe77156a76cdbf1dcf1e1))
- Compiler stage 3: recall core + session-compat (verbatim port, self-tested) ([`3b389c2`](https://github.com/jwitmann/opencode-vcc-compaction/commit/3b389c2521a8f7024c70ac98ae4534c769bce424))
- Compiler stage 4: search core (verbatim port, self-tested) ([`a32a5b9`](https://github.com/jwitmann/opencode-vcc-compaction/commit/a32a5b9cc71dce6c365a423b17217642f9616df0))
- Valid plugin opencode-vcc-compaction 0.1.0: Effect-direct hook + adapter (unit-tested, live-verified) ([`3c3e807`](https://github.com/jwitmann/opencode-vcc-compaction/commit/3c3e8076ae523391dcf3e796210d2fadc4b6d8af))
- Vendor engine into vcc-plugin + CI publish flow ([`aed56e9`](https://github.com/jwitmann/opencode-vcc-compaction/commit/aed56e9e99db38d8c79ffb5f1966d819a61afa48))
- Product-repo reorg: archive probe workspace, examples/, rename package to opencode-vcc-compaction ([`4079e0b`](https://github.com/jwitmann/opencode-vcc-compaction/commit/4079e0b8cab464d8a683f254d42b47d7e53db444))

### Fixes

- Review follow-up: drop redundant header line in tokenize.mjs ([`1f10abf`](https://github.com/jwitmann/opencode-vcc-compaction/commit/1f10abf5193b22827cf864f651dea808bfd0a674))
- Plugin review follow-ups: contiguous seqs, guarded hook, buffer doc sync ([`180474c`](https://github.com/jwitmann/opencode-vcc-compaction/commit/180474cb442a2347c664ac5257c18af52236837a))
- Revert bogus no-Effect rule (misread owner intent) ([`466d1f2`](https://github.com/jwitmann/opencode-vcc-compaction/commit/466d1f2f0c664f7870f5f5982be79473585c9fda))
- Harden engine-sync gate (review findings) ([`dc50338`](https://github.com/jwitmann/opencode-vcc-compaction/commit/dc503388e281c543bbdfe3bf6a2bb89e73d0278d))

### Documentation

- Organize durable docs under docs/ (typed layout) + verdict ([`81daf53`](https://github.com/jwitmann/opencode-vcc-compaction/commit/81daf534d454be7d77ae36a03925a82d2368e569))
- Resolutions stay in this repo (docs/research), no fold-back ([`e33fffe`](https://github.com/jwitmann/opencode-vcc-compaction/commit/e33fffe989b25cc1a5c62b13030c960bce9747ec))
- Port finnomena guidelines: NOTES.md parking lot, ask-first, plan compliance ([`56a05de`](https://github.com/jwitmann/opencode-vcc-compaction/commit/56a05defacd4fcf593d5b10808ac7f5ddf2f6368))
- Plan: record Effect as canonical plugin style for hook adapter ([`6e9c32c`](https://github.com/jwitmann/opencode-vcc-compaction/commit/6e9c32c1291da4902d7773e5b7073ca6bc3669ee))
- Plan: name the end game - valid shippable plugin, Effect-direct adapter ([`c7d63e1`](https://github.com/jwitmann/opencode-vcc-compaction/commit/c7d63e1e402ae223a5d82948dd551bec18afa914))
- Public face batch A: root README rewrite, package metadata, LICENSE, install notes ([`dfe0815`](https://github.com/jwitmann/opencode-vcc-compaction/commit/dfe08152ad17170c8d6e5b988ae75011a00c2c3a))
- Docs sync: agent layout, plan package bullet, compaction.buffer install notes ([`8201b04`](https://github.com/jwitmann/opencode-vcc-compaction/commit/8201b04713cf0d2adc1fdd102ccaa367516177e7))
- Move closed specs PROBE/REUSE to docs/archive, fix references ([`f8c67a2`](https://github.com/jwitmann/opencode-vcc-compaction/commit/f8c67a21b2b0d28abfcf50a34b4fec148f92c8ed))
- Enrich READMEs to full-manual standard ([`559f6c8`](https://github.com/jwitmann/opencode-vcc-compaction/commit/559f6c86c52d0318b62edd37ea0fc4620c308656))
- Cut publish-pipeline detail from install sections ([`f309364`](https://github.com/jwitmann/opencode-vcc-compaction/commit/f309364a4a6fb37f7ae09fa80457c5d65995ceca))
- Add Performance section with measured sweep ([`22fe3e5`](https://github.com/jwitmann/opencode-vcc-compaction/commit/22fe3e526e737a89dd78dcd00069648933daee0b))
- Release-ready docs: npm-first install, single-manual structure, audit fixes ([`5dde34b`](https://github.com/jwitmann/opencode-vcc-compaction/commit/5dde34b1ff6d35bdd11cc2d1f21193793df56e70))

### Other

- Promote probe workspace to tracked project ([`fd5f30a`](https://github.com/jwitmann/opencode-vcc-compaction/commit/fd5f30abab78a547212c20f58ce379719a87b3da))
- Untrack dev-framework config (local-only per .gitignore) ([`2afffac`](https://github.com/jwitmann/opencode-vcc-compaction/commit/2afffac23f212ee30cea41c6536b88e8a5d13003))
- Pin probe deps (bun.lock, @opencode/plugin 2.0.14) ([`39f5898`](https://github.com/jwitmann/opencode-vcc-compaction/commit/39f5898b70f435651fe757bb0d3c3c6cc4247de4))
- Rule: this workspace stays Effect-free (owner decision) ([`88ca33c`](https://github.com/jwitmann/opencode-vcc-compaction/commit/88ca33c99665793a79ef42267a9c97957f0d2c08))
- Author holder jwitmann per GitHub account ([`d54e2f0`](https://github.com/jwitmann/opencode-vcc-compaction/commit/d54e2f08550c84d254a5e57786ea0d5a03fa5c95))
- Release process: release.sh + changelog.sh + CHANGELOG seed ([`d910375`](https://github.com/jwitmann/opencode-vcc-compaction/commit/d91037591631006d065bb12d87bc00e2efb4ad55))
- release.sh: fix validation comment (engine-sync, not evidence gate) ([`a3234c4`](https://github.com/jwitmann/opencode-vcc-compaction/commit/a3234c4789a149e98466d2042dfad96667870889))
- release.sh: push only the release tag, fix validation comment ([`f02a07a`](https://github.com/jwitmann/opencode-vcc-compaction/commit/f02a07a23a515ce3ed29219fff97c044056b911c))
