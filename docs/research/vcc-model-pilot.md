# Pilot: VCC vs compaction-model (single fight)

**Status:** round 2 complete — both plugins engaged and genuine.
Verdict below; open follow-up is a fire-point-matched rematch
(see fairness caveat).
**Base:** host `opencode v2.3.2`, `@opencode/plugin 2.3.2`, `effect 4.1.0`.
Ours `opencode-vcc-compaction@0.3.3` (`/tmp/pilot-vcc/`: absolute
package path, maxTokens 2000, keepMessages 4, buffer 99%). Theirs
`@madsoftwaredev/opencode-compaction-model@0.1.3` (`examples-model/`:
their default summarizer `opencode-go/deepseek-v4.1-flash#max`, buffer
99% — override dropped after round 1 proved contributor incompatible
with their Go adapter).
Working model both sides: `opencode-go/muse-spark-1.3-contributor`.

## Harnesses

- `/tmp/pilot-vcc/` — VCC side (this pilot only, Brain-free, absolute
  package path; committed `examples/` keeps portable `..` for TUI use).
- `examples-model/` — contender side (this pilot only, Brain-free).

Both run headless from their own cwd:
`opencode run --session <SID> --model <MODEL> --auto "<PROMPT>"`.
First turn omits `--session` and captures the id from `--format json`;
later turns reuse it. After each turn, poll for the compaction row
before continuing (so history accumulates first, then fires).
Turn 1 (mango seeding) is pre-seeded in the harness files rather
than run as a turn; the driver runs turns 2–6.

## Script (same both sides, in order)

1. `Write a file called alpha-notes.md in this directory with three short paragraphs about mango caching. Do not ask questions, just do it.`
2. `Append a paragraph stating the retry budget is 17 and the deploy freeze rule is: never deploy on Fridays. Just do it.`
3. `Read back alpha-notes.md and report its line count with wc. Just do it, no questions.`
4. `Write beta-notes.md containing the exact token sk-pilot-7Q2X-needle-4913 and one sentence saying it belongs to the staging vault. Just do it.`
5. `Run ls in this directory and report the full listing. No questions.`
6. `Append to alpha-notes.md: we chose mango-cache.json with TTL 3600 because the p99 stayed under 40ms. Just do it.`
7. Short turns (`Say ok.`, `Say done.`, …) until the compaction row appears
   (max 5 short turns; stop early if the row lands).

## Needles (planted above)

- N1: token `sk-pilot-7Q2X-needle-4913` (file, verbatim expected).
- N2: retry budget `17` (chat text).
- N3: `mango-cache.json`, TTL `3600`, p99 `40ms` (chat text).
- N4: `ls` listing contents incl. `needle-dir-alpha` (tool result).
- N5: `never deploy on Fridays` (user-stated constraint).

## Post-compaction (same both sides)

- Continuation task: `Write the staging vault token into vault-check.txt, then state the retry budget and the deploy freeze rule. No questions.`
- Score: needle present verbatim / pointer-recoverable (`/vcc-recall`) /
  paraphrased / invented / missing; continuation pass-fail.
- Row check: `opencode api get
  '/api/session/<SID>/message?type=compaction&order=desc&limit=1'` —
  record summary chars + usage fields present/absent + metadata keys.

## Step 0: baseline (load checks — before any turns)

Lesson learned: verify activation before measuring. For each side,
in a throwaway session from its harness dir:

- VCC: `/vcc-status` must answer (proves hook + commands registered).
  Proof in service log: `loading plugin` with no `failed to load`.
- Model: service log `loading plugin
  id=@madsoftwaredev/opencode-compaction-model@...` with no failure,
  AND `compaction-model.log` must show adapter success (no
  `requires an OpenAI-compatible chat model` fallback lines) after
  the first compaction — fallback means we measured host-native, not
  their summarizer.

Baseline failures found 2026-11-21 (both sides void, see verdict below):

- VCC: `failed to load plugin target=..`: service resolved the
  relative path against the wrong base (`/home/package.json`
  ENOENT). Headless `run` ≠ TUI path (live verdict proved `..`
  works interactively). Pilot fix: `/tmp/pilot-vcc/opencode.jsonc`
  with absolute `package: /home/jerome/opencode-vcc-port`; committed
  `examples/opencode.jsonc` keeps portable `..` (TUI-proven).
  Service log confirms `loading plugin
  id=/home/jerome/opencode-vcc-port` for `/tmp/pilot-vcc` (no
  failure). Open: `/vcc-status` still reports COMMAND MISSING even
  warm — command registration in `run` sessions unverified;
  the hook (what the fight needs) is tested by the round-2 run
  itself.
- Model: plugin loaded, but every compaction logged `The Go
  compaction adapter requires an OpenAI-compatible chat model.
  Falling back to the session model.` — our `options.model`
  override (`opencode-go/muse-spark-1.3-contributor`) is not
  OpenAI-compatible, so we measured host fallback, not their
  summarizer. Pilot fix: drop the override, use their default
  (`opencode-go/deepseek-v4.1-flash#max`, OpenAI-compatible via
  their Go adapter).

## Result, round 2: both plugins genuine (2026-11-21)

VCC: `ses_e01e68f4affeekxWLPUhlP7KXT`,
compaction `msg_1fe19f82b001Qg0U34RWq15KYk`, 2497 chars, header
`[opencode-vcc-compaction vcc-compiler-debug-2: 15 messages ->
19 entries]` inside the collapsible `<details>` block. No
usage/billing keys on the row — zero model call. Hook path proven
live headless; the absolute-path harness fixed round 1.

Contender: `ses_e01e5dee8ffeZhfOGT5tD00Vw1`, compaction
`msg_1fe1c21e0002krcBIfPGfOXS2u`, 5272 chars, template
`Objective / Requirements / Decisions / Work State / Active /
Blocked / Next Move / Relevant Files / Important Context`.
`metadata.compactionModel =
"opencode-go/deepseek-v4.1-flash#max"` plus `compactionPlugin =
"compaction-model"`, and their log shows six `summarized with
opencode-go/deepseek-v4.1-flash#max` lines for the session, zero
fallback lines — a genuine summarizer measurement.

| | VCC side | model side |
|---|---|---|
| Summary chars | 2497 | 5272 |
| N1 token | verbatim (in beta prompt echo) | verbatim |
| N2 retry 17 | verbatim | verbatim |
| N3 mango/TTL/p99 | missing — timing artifact (mango turn landed after the row fired) | verbatim |
| N4 `ls` listing | verbatim (`needle-dir-alpha/`, `marker.txt`) | verbatim (full `ls -la`) |
| N5 Fridays | verbatim | verbatim |
| Continuation | pass (token exact, 17 + Fridays stated) | pass (token exact, 17 + Fridays stated) |
| Row usage fields | absent | absent |
| Metadata keys | `keepID` | `keepID`, `compactionModel`, `compactionPlugin` |
| Wall latency | compacted at poll 1 | compacted at poll 1 |

Read: VCC is a lossless slice (prompts + tool I/O verbatim, no
synthesis, no paraphrase risk) at zero inference cost; the
contender synthesizes (file states, line numbers, even the
`We`-vs-`we` capitalization discrepancy) at one summarizer call
plus a larger row. Both continuations pass, so neither dropped
what the task needed.

Fairness caveat: same `buffer: 99%`, but the VCC harness sets
`maxTokens: 2000` while the contender harness sets no maxTokens
(host default applies) — so VCC fired mid-script (row covers
turns 1–3) and the contender fired after all 5 turns. The N3 gap
is a fire-point artifact, not a quality signal. A strict rematch
would set both harnesses to the same absolute budget (if their
plugin respects host maxTokens — unverified).

Conduct notes: the contender session wrote all note files into
`examples/` instead of its own cwd `examples-model/` (its summary
acknowledges the cwd confusion); files are gitignored pilot
artifacts, `git status` clean. `/vcc-status` still reports
COMMAND MISSING in `run` sessions — hook proven, command
registration headless unverified (unchanged).

## Verdict, round 5: multi-cycle needle survival (2026-11-21)

Question cost/latency cannot answer: over repeated compactions in
one long session, do early needles survive each cycle's rewrite?
Three cycles per side, one session per side, identical seeds;
score early/mid survival per compaction row + final continuation.
Owner-approved; driver `/tmp/pilot6-master.sh` (sequential arms;
`pilot6-cycle.sh` reuses the arm SID, 6 turns per cycle, target N
compactions for cycle N).

- Harnesses `/tmp/pilot6-vcc/` + `/tmp/pilot6-model/` (identical
  `orchard.md` seed + `needle-dir-alpha/marker.txt`); VCC config
  `..` maxTokens 2000 keepMessages 4 buffer 99%; contender pinned
  0.1.3 buffer 99% default deepseek-flash summarizer.
- Cycle 1 (early): plant `cellar-early-11` + `frost-early-22`,
  orchard read, `ls`, 3× bulk appends. Cycle 2 (mid): plant
  `loft-mid-33` + `heat-alarm loft-mid-44`, 5× bulk appends.
  Cycle 3: 6× bulk appends (no new plant — design gap, see below).
- Methodology note: the driver's `?type=compaction` poll reads 0
  even with rows present (same illusion as round 1's COMMAND
  MISSING — poll path, not product). Ground truth is session state
  (`/api/session/<SID>/message`, full dump, `limit=200` — note
  `limit=300` returns empty). Side effect is benign: targets never
  trip early, so all 18 turns run per arm.

Counts (session state): VCC `ses_e01af91aefferjQVQx0bqGM6zv`
18 turns, 11 rows; contender `ses_e01ab1960ffe2Gq7g6ZaaPR61m`
18 turns, 4 rows. Row counts differ (the host fires per pressure,
not per plan) — no top-up needed; survival is scored per row, and
the continuation probe is identical.

Per-row planted-needle survival (Y = verbatim in row text):

| row | VCC (11 rows) | model (4 rows) |
|---|---|---|
| cycle-1 row(s) | 3496 chars, early YY | 3360 chars, early YY |
| cycle-2 row(s) | 1039 chars, row-text nn (row 1 persists live, so context keeps early) | 4679 chars, early YY + mid YY |
| cycle-3 rows | five checkpoints 1–7.4KB, mixed windows | 6041 chars YYYY; 7033 chars YYYY |
| probe-turn rows | 4 host-template + 2 checkpoints (see interleave) | — (probe added no row) |
| latest row | 1454 chars, YYYY | 7033 chars, YYYY |

Row-size behavior: VCC checkpoints stay small (1–7.4KB; the last
two stable at identical 1454 chars — the deterministic compiler
converges); contender rows grow monotonically (3.3 → 4.7 → 6.0 →
7.0KB — the synthesizer restates everything each cycle).

Continuation (identical probe both sides, post-pilot single turn):
both recover 4/4 planted needles with exact values and invent
zero. The VCC agent additionally catalogs bulk distractors
(`c1bulk*`, `c2bulk*`, `c3bulk*`) as ignore-list; the contender
agent explicitly declines the unplanted archive pair ("no singular
archive token was recorded"). Both PASS.

Design gap (honest): cycle 3 plants no late needles — its six
turns are bulk-only, so "late" survival is untested and the
`archive-late-55/66` names in the interim note were never
introduced anywhere. Cycle 3 still tested repeated-rewrite
stability (VCC's extra checkpoints, contender growth to 7KB). A
strict late-needle test would add a plant turn to cycle 3.

Open follow-up (ours to address): during the VCC probe turn, 4 of
11 rows are host-template (`## Objective/...`, the round-1 VOID
shape) interleaved with our checkpoints — the host went around
our hook under sustained-99% pressure (all 4 still preserve YYYY,
no loss observed). Candidates: our hook abstained (Effect
failover) vs a host mid-step path that skips hooks. Unresolved —
needs the service log (not at the expected state-dir path this
session). No product change: needles survive either path and the
continuation passes.

Bottom line: multi-cycle survival holds both sides. VCC is a
bounded deterministic slice (small stable rows, zero inference
calls); the contender cumulatively synthesizes (every row keeps
all needles so far, rows grow each cycle, one summarizer call per
compaction). Defaults stand; no benchmark needed — cost/latency
are givens and survival is now measured.

## Result, round 4: prefix recall — probe bug, corrected 8/8 (2026-11-21)

Question: the rows cover only the compacted prefix as prose, the
live tail stays in context — but is compacted-away content
recoverable through the recall path (`/vcc-recall`, `/vcc-search`)?

Method: fresh VCC harness `/tmp/pilot4-recall/`, 8 distinct needles
(`alpha-gamma-11` … `mu-nu-88`, `vault-recall-66`,
`scratch-delta-77`), drove to auto-compaction
(`ses_e01d14061ffek1Aa8pKeiiuJ6q`, row
`msg_1fe311a68001DtzuTpGzFbvZud`), then checked the snapshot store
directly (headless `run` cannot execute slash commands — the
`/vcc-recall zeta-eta-33` attempt was answered by the agent with a
workspace `grep`, not the command; same wall as `/vcc-status`).

Correction (same day): first scoring passed the whole envelope to
`searchSnapshot`, which takes the messages array — probe bug, not
product. Re-run correctly over `stored.messages`: **8/8 needles
recovered**. The checkpoint message (first in the store) carries the
full summary prose verbatim and search indexes it. The "0/8 GAP"
first reported was measurement error; the prefix survives as prose
and "nothing is lost" holds for content.

Residual gap (real, narrower): *event-granular* recall of
compacted turns. The store holds checkpoint + live tail, so `seq` /
`result` refs resolve against tail events plus one prose blob — a
prefix turn is not individually addressable. Fix direction
(approved, built, pending review): append-mode snapshots with a
retention bound (K=50 newest-wins as `snapshotMaxMessages` /
`snapshotFullPayloadMessages` config, defaults 50/20), so prefix
events persist as events and the O(n²) rewrite stays O(bound).
Live-verified same day (`ses_e01b7c24bffeYehL1ULGqbiszp`): stored
envelope holds 50/50 messages (cap active, 20KB), all 5 live needles
recovered via search, prefix needles present as non-checkpoint
events, `aged:true` flags present — the merge path fires in
production. Headless slash-command uninvokability stands as the
separate, host-side half.

## Result, round 3: rematch — asymmetry flipped, cause is noise (2026-11-21)

Identical fresh seeds (`/tmp/pilot3-vcc/`, `/tmp/pilot3-model/`),
per-turn polling, same configs and models as round 2.

VCC: `ses_e01dd9eafffeA1869fqiDBA9Lk`,
compaction `msg_1fe2355fc002he7K3xf3TSrbhf`, 4231 chars, header
present, `<details>` present. Covers turns 1–2 + beta prompt
(prefix compacted, turns 3–5 live tail). N2/N5 verbatim, N1
verbatim (beta prompt echo), N4 verbatim (dir entries in tool
output), N3 out of coverage (mango turn in live tail).

Contender: `ses_e01dcee8cffe7DyvO5QzXDEv0W`, compaction
`msg_1fe23d2140015EbCcY7N5IdVcL`, 2138 chars,
`metadata.compactionModel` stamped, log shows `summarized with
opencode-go/deepseek-v4.1-flash#max` for the session. Covers turns
1–2 (beta turn 3 is the live tail). N2/N5 verbatim, exact edit
wording quoted; N1 N/A (beta outside coverage, not a miss); N4
partial (config + marker mentions, `ls` turn not yet run).

Continuation: both pass — exact token in `vault-check.txt`, 17 +
Fridays stated.

The finding: round 2 fired VCC-early / model-late; round 3 fired
model-early (turn 3) / VCC-late (turn 5) with byte-identical seeds.
The asymmetry flipped, so it is run-to-run sampling noise in agent
tool paths (per-turn token burn differs), not a systematic bias and
not our timing bug. The fire-point issue is closed as noise; the
common-prefix scoring stands as the method. No product change
needed. Side win: the round-3 seed fix worked — the contender
stayed in its own cwd this time.

| (common prefix, turns 1–2) | VCC | model |
|---|---|---|
| N2 retry 17 / N5 Fridays | verbatim / verbatim | verbatim / verbatim |
| N1 token | verbatim (prompt echo) | N/A (outside coverage) |
| Row usage fields | absent | absent |
| Continuation | pass | pass |

## Open issue: fire-point asymmetry (ours to address)

Under identical `buffer: 99%` and the same working model, VCC fired
mid-script (row covers turns 1–3) while the contender fired after
all 5 turns. Our plugin does not inflate context (the context hook
only snapshots to storage; `maxTokens` is the compile budget, not
the fire threshold), so the cause is unproven — likely session-path
divergence: the contender strayed into `examples/` (round-1
polluted, 12-line file, duplicate-match retry) while VCC worked a
fresh dir, so per-turn token burn differed. But "likely" is not
evidence. Addressed by the rematch design below: identical fresh
seeds both sides, per-turn polling, common-prefix scoring — fair
whatever the cause. If asymmetry persists with identical seeds,
next step is host fire-threshold investigation (owner call).

## Rematch design (round 3, owner-approved)

- Fresh harnesses `/tmp/pilot3-vcc/` + `/tmp/pilot3-model/` with
  byte-identical seeds (`alpha-notes.md` mango paragraphs +
  `needle-dir-alpha/marker.txt`); `examples-model/` gets its own
  `alpha-notes.md` seed (round 2 lacked one — the stray cause).
- During the rematch, `examples/*.md` pilot artifacts move to `/tmp`
  (restored after) so a straying agent cannot find polluted files.
- Configs unchanged (VCC `maxTokens 2000, keepMessages 4`; contender
  default summarizer; both `buffer 99%`) — only seeds change.
- Poll after EVERY turn; stop each side at its first compaction row.
  Score needles in the common prefix + identical continuation task.
  (Round-3 result: asymmetry flipped → noise, issue closed; method stands.)
- Success: same fire turn both sides, or a scored common prefix
  either way; plus one step toward the fire-point cause.

## Result, round 1: VOID both sides (control baseline only)

Both sides ran all 5 content turns and auto-compacted at the same point
(poll 1 both sides — trigger parity confirmed). But both rows are
**host-native**: model-style `Objective/Requirements/...` template,
billed tokens (`input ~700-800, output ~340-370`), no VCC header on our
side (`summary_chars` 1339, no `[opencode-vcc-compaction ...]` marker),
no `metadata.compactionModel` on theirs. `metadata.keepID` is present
both sides — it is a host-native field, not proof of either plugin.

- VCC side: `ses_e01f34fb6ffe04vg1H1ViQ0ej6`,
  compaction `msg_1fe0da786001FyOpo4HFuZX54Z`, 1339 chars.
- Model side: `ses_e01f2c66dffei5va3nvOiDtBbw`, 1330 chars, same template.

Diagnosis (round 1, superseded): `/vcc-status` force-probe twice
returned `COMMAND MISSING`. Service-log proof (readable via node):
`failed to load plugin target=.. — Could not read package.json:
ENOENT '/home/package.json'`. Standalone `--print-logs` red herring
(`~/.local/state` mkdir) is sandbox-only; the service is unsandboxed.
Value banked: harness parity (identical trigger timing), scripts +
needles + scorecard ready, control-baseline rows for "no plugin".

(Scorecard lives in the round-2 table above.)
