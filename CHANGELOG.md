# Changelog

<!-- markdownlint-disable MD024 --><!-- repeated bucket headings -->

Generated from commit subjects (`scripts/changelog.sh`).
Single source: the tag-triggered workflow publishes each version's
section as the GitHub release notes, so this file and the release
page never diverge.

## [v0.3.4] - 2026-11-21

### Features

- append-mode snapshots with retention bound (K=50, payload aging, config) ([`b3279eb`](https://github.com/jwitmann/opencode-vcc-compaction/commit/b3279eb98cb0838dc61418ca51511c8d4b73ed25))

### Fixes

- warn on compaction-hook abstain; docs: resolve round-5 host-template interleave cause ([`f6fb2d3`](https://github.com/jwitmann/opencode-vcc-compaction/commit/f6fb2d321838071a1a8f698f8fad72a454d0e276))

### Documentation

- sync version references to 0.3.3 post-release ([`8e2e97e`](https://github.com/jwitmann/opencode-vcc-compaction/commit/8e2e97e5558362a07d17c8df156fc5f860dca8d9))
- sync stale v0.3.2 status ref to v0.3.3 in README ([`5b78508`](https://github.com/jwitmann/opencode-vcc-compaction/commit/5b78508b2607bb15e646d39cdc905030604e46e6))
- drop hardcoded versions from README, changelog owns them ([`3dc74c5`](https://github.com/jwitmann/opencode-vcc-compaction/commit/3dc74c5dec8ac4cbcedbd7c85064b4806d5989f0))
- full README audit, fix 8 inconsistencies vs code and host docs ([`1542d20`](https://github.com/jwitmann/opencode-vcc-compaction/commit/1542d202360c35eb66ec076e4402442fe4277f2b))
- resolve parked notes - bench script, research index, version-free AGENTS ([`7d66271`](https://github.com/jwitmann/opencode-vcc-compaction/commit/7d66271f30f3526796ba2b3731f61e38e62be969))
- V2 comparison plan (compaction-model main event, borrow list) ([`d782be9`](https://github.com/jwitmann/opencode-vcc-compaction/commit/d782be9f469b92f389256e51a68ef153ed5df7e9))
- cite DCP manual-mode precedent for on/off switch ([`b478f2c`](https://github.com/jwitmann/opencode-vcc-compaction/commit/b478f2cc8c7a80441909ea0a033b998fa106ba6f))
- note claude-code is an in-OpenCode plan route ([`c981cea`](https://github.com/jwitmann/opencode-vcc-compaction/commit/c981cea4e6b28a3951caae7f7d2d58c32dd33dcc))
- drop cap-scaling and dry-run parked items ([`dc14602`](https://github.com/jwitmann/opencode-vcc-compaction/commit/dc14602161d14b70a771b24ad2ccb563b44c9bc1))
- add standing board to V2 comparison plan ([`6d131f3`](https://github.com/jwitmann/opencode-vcc-compaction/commit/6d131f3540afdc5103a30adc6fa4467867255c54))
- single-contender comparison plan ([`d9162da`](https://github.com/jwitmann/opencode-vcc-compaction/commit/d9162dad16481d9e968c4186dada93ed1a6c31d9))
- pilot prep for VCC vs compaction-model fight ([`133cb41`](https://github.com/jwitmann/opencode-vcc-compaction/commit/133cb41ffaf33bf8d6b0f1ca2405abe02d1a9732))
- pilot void verdict, plugin load blocked in sandbox ([`779f64a`](https://github.com/jwitmann/opencode-vcc-compaction/commit/779f64a346eefe472bfac8fc16efb4f884bb8995))
- pilot round 2 baselines (absolute harness, default summarizer) ([`301cee0`](https://github.com/jwitmann/opencode-vcc-compaction/commit/301cee0f00fb8bd6dc7f5f5cf68ade08670301ca))
- pilot round 2 running, warm-load proof ([`93ca73c`](https://github.com/jwitmann/opencode-vcc-compaction/commit/93ca73c1e9b0b790b042df62e1f65216af327876))
- round-2 pilot verdict, both plugins genuine ([`284ce00`](https://github.com/jwitmann/opencode-vcc-compaction/commit/284ce003b0d4aa7b8892d10c7a24a165b9941f28))
- round-3 rematch verdict, fire-point asymmetry is noise ([`a75dfe5`](https://github.com/jwitmann/opencode-vcc-compaction/commit/a75dfe57997e99fa93da6e1022f639ddb68b245c))
- round-4 prefix-recall gap, snapshot covers live tail only ([`1053ee0`](https://github.com/jwitmann/opencode-vcc-compaction/commit/1053ee0dbf91810cc4702192503ced80386bfd93))
- dated correction (retention bound) + live merge verification ([`06086be`](https://github.com/jwitmann/opencode-vcc-compaction/commit/06086be396088e1c2d62e4bec31caee93bc636d0))
- round-5 multi-cycle needle-survival verdict (VCC 11 rows vs model 4 rows, both 4/4 continuation) ([`99396aa`](https://github.com/jwitmann/opencode-vcc-compaction/commit/99396aa2b4ae3e4324bf8942bf73abc7e8e2ae29))
- note upstream boundary (keepID/abstain/store are ours, engine is verbatim) ([`7a4f1ca`](https://github.com/jwitmann/opencode-vcc-compaction/commit/7a4f1caa9e87110f189872d1202e88645f8b7003))

## [v0.3.3] - 2026-11-21

### Fixes

- sessionEventAt legacy miss returns undefined, not a wrong event ([`bde85b8`](https://github.com/jwitmann/opencode-vcc-compaction/commit/bde85b8fa686cfff5ee43e68b8c9269a91095f9e))

### Documentation

- fix release.sh validation comment (engine-sync gate is gone) ([`94342ba`](https://github.com/jwitmann/opencode-vcc-compaction/commit/94342baa4c7c7c68597cb392bd829acaac4cf0e4))

### Other

- root-as-package layout, single README, one engine/ ([`1bd8634`](https://github.com/jwitmann/opencode-vcc-compaction/commit/1bd8634b4de1dd16393575e10ec22ac841dcc633))

## [v0.3.2] - 2026-11-20

### Features

- wrap compaction summary in single collapsible details layer ([`b8f3185`](https://github.com/jwitmann/opencode-vcc-compaction/commit/b8f318509ed5363bf906a49deba004d4b184fef2))

### Documentation

- live verdict for collapsible checkpoint wrapper ([`8b03ac3`](https://github.com/jwitmann/opencode-vcc-compaction/commit/8b03ac37cf14b7fbf74330e30bfe2915da61984e))

## [v0.3.1] - 2026-11-20

### Features

- host-native toast attribution via sessionID; dialog broadcast declared ([`7a8b040`](https://github.com/jwitmann/opencode-vcc-compaction/commit/7a8b0405bc2b26c63cca974b5b5084a6b83c9303))
- snapshot >1MB write tripwire with interim real-density note ([`d83c408`](https://github.com/jwitmann/opencode-vcc-compaction/commit/d83c4087c300518ee2b2efb41874346991408e82))
- queryable O(N2) watch stats per session (vcc-stats key) ([`e421c02`](https://github.com/jwitmann/opencode-vcc-compaction/commit/e421c026220e5963b5ceb84f310467c5ecaf3d6d))

### Fixes

- remove stray ternary colon breaking host plugin build ([`526e0a3`](https://github.com/jwitmann/opencode-vcc-compaction/commit/526e0a3f5c04280411f566b69712f2dd14810b50))
- searchSnapshot index-0 hole steals no hit slot or budget ([`49587c6`](https://github.com/jwitmann/opencode-vcc-compaction/commit/49587c6fd95c55bc9f1754991b45087dba491878))

### Documentation

- sync version references to 0.3.0 post-release ([`10a5f17`](https://github.com/jwitmann/opencode-vcc-compaction/commit/10a5f179af276d6ac6186547b6534d32ed03e1ba))
- post-session O(N2) revisit — tripwire suffices, incremental parked ([`7e911aa`](https://github.com/jwitmann/opencode-vcc-compaction/commit/7e911aa913c81850047f8628c6a3e44cc437693f))
- record seq-semantics resolution as dated correction note ([`b4aac47`](https://github.com/jwitmann/opencode-vcc-compaction/commit/b4aac479eb8b4326158dfac68d988801f203ede7))

### Other

- skip redundant snapshot rebuild in compaction hook ([`d8f6de7`](https://github.com/jwitmann/opencode-vcc-compaction/commit/d8f6de77d6597733c63b9517fc3d97240d750ec2))
- publish via npm Trusted Publishing (OIDC), drop NPM_TOKEN ([`55d4c2d`](https://github.com/jwitmann/opencode-vcc-compaction/commit/55d4c2d3f2f07877379249a2cbd2c94f855f9aaa))

## [v0.3.0] - 2026-11-19

### Features

- RPC event-push reply bridge with TUI companion; real-repo workspace ([`9d751c9`](https://github.com/jwitmann/opencode-vcc-compaction/commit/9d751c9d0cecc87c075e17059632b4064d4a7ddc))

### Fixes

- wake-free command replies via synthetic resume:false ([`e1450ad`](https://github.com/jwitmann/opencode-vcc-compaction/commit/e1450ad1ff88845158d21fc28d65de5fb4e46074))

### Documentation

- record TUI live proof; sync release script to workspace gates ([`5515776`](https://github.com/jwitmann/opencode-vcc-compaction/commit/55157763e134a7aacb18c0d0ddc65d33cdfee249))

### Other

- wake-free command replies via synthetic resume:false ([`05d7ba5`](https://github.com/jwitmann/opencode-vcc-compaction/commit/05d7ba5c779f4983093cc054af6e52f19473ef00))

## [v0.2.0] - 2026-11-19

### Features

- snapshot store for vcc- commands (Phase 1) ([`74c268c`](https://github.com/jwitmann/opencode-vcc-compaction/commit/74c268c4b78c7ec4557666e9a5291b3ec01246b0))
- wire /vcc-recall server command (Phase 2) ([`2f602e6`](https://github.com/jwitmann/opencode-vcc-compaction/commit/2f602e6153a02531824e48cce8340a101fc1871f))
- wire /vcc-search + /vcc-status server commands (Phase 3) ([`63f2bf4`](https://github.com/jwitmann/opencode-vcc-compaction/commit/63f2bf47af2ceed5be3a8844927503eeb0b6ea20))

### Fixes

- Effect v4 compat (catch/catchCause) + repair vcc-status chain ([`526f19a`](https://github.com/jwitmann/opencode-vcc-compaction/commit/526f19a2ceca0773dcc07c535b36827ae7774e24))

### Documentation

- curate v0.1.0 changelog into ODF buckets, adopt conventional commits ([`e364566`](https://github.com/jwitmann/opencode-vcc-compaction/commit/e364566bbab7ac4f1b334d4cd43389b1aa1cb8d9))
- plan vcc- commands for 0.2.0 (snapshot-via-hook) ([`560b563`](https://github.com/jwitmann/opencode-vcc-compaction/commit/560b563a4af5e144dc6fc356ac7c26c2bc1a35e8))
- document vcc- commands for 0.2.0 (recall/search/status, snapshot-via-hook) ([`0f0a6ab`](https://github.com/jwitmann/opencode-vcc-compaction/commit/0f0a6abdf628fa3afaeb2512a8a9c6a3cae82a3f))
- live proof verdict for vcc- commands (0.2.0 code) ([`2c2e27a`](https://github.com/jwitmann/opencode-vcc-compaction/commit/2c2e27ad8d97b56449d5cc09aef14b8409b178aa))

### Other

- fix validation comment (engine-sync, not evidence gate) ([`a3234c4`](https://github.com/jwitmann/opencode-vcc-compaction/commit/a3234c4789a149e98466d2042dfad96667870889))
- push only the release tag, fix validation comment ([`f02a07a`](https://github.com/jwitmann/opencode-vcc-compaction/commit/f02a07a23a515ce3ed29219fff97c044056b911c))
- generate full-history v0.1.0 section from commit subjects ([`ee32ed6`](https://github.com/jwitmann/opencode-vcc-compaction/commit/ee32ed6bef1622f2044e3c5b36a8039e87b0a7b0))

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
