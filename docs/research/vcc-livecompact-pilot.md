# Pilot: VCC vs Live Compact (growth-curve fight)

**Status:** running (2026-11-21). VCC arm in flight; live-compact arm queued.
**Base:** host `opencode v2.3.2`. Ours `opencode-vcc-compaction@0.3.4`
(`/tmp/pilot7-vcc/`: absolute package path, maxTokens 2000,
keepMessages 4, buffer 99%). Theirs
`opencode-live-compact@0.1.2` pinned (`/tmp/pilot7-live/`,
defaults: 20k-token trigger, 1k min cut, 3 cuts/turn, buffer 99%).
Working model both sides: `opencode-go/muse-spark-1.3-contributor`.

## Why this fight

Round 5 benched summarizer-vs-checkpoint (same fire point, different
summary). Live Compact is a genuinely different design: continuous
small shaves after successful turns (plus a replacement at host
compaction) instead of one big compile at fire time. The question is
continuous-shaving vs checkpoint-at-fire: context-growth curves,
needle survival, final continuation.

## Harnesses

- `/tmp/pilot7-vcc/` + `/tmp/pilot7-live/` — identical `orchard.md`
  seed (cycle-seven graft log) + `needle-dir-alpha/marker.txt`.
- Driver `/tmp/pilot7-master.sh` (sequential arms, 45s gap);
  `/tmp/pilot7-cycle.sh` reuses the arm SID, logs per-turn
  `msgs/in/out/compactions` (token sums are cumulative integrals —
  each message logs context-at-creation — so curves compare slopes,
  not absolute windows).
- 18 identical turns: plant early (cellar-early-71 + frost-early-72),
  orchard read, ls, 3× bulk1; plant mid (loft-mid-73 + heat-mid-74),
  5× bulk2; plant late (archive-late-75 + archive-late-76), 5× bulk3.
  Filler turns re-read seed files so volumes cross the 20k trigger.

## Step 0: baseline (before any turns)

- VCC: throwaway turn runs, hook engaged (proven across rounds 2–5).
- Live Compact: `live_compact_status` callable, returns
  `{"state":"waiting-for-completed-turn"}` — loaded and engaged on
  host 2.3.2 despite targeting 2.2.6 APIs. Service log shows clean
  `loading plugin id=opencode-live-compact@0.1.2` lines, no failures
  after the pilot6 window (stale `failed to load` lines at 13:14–13:15
  UTC predate this pilot; loads since are clean).
- Bundle recon (npm cache): hooks `compaction` (replacement) +
  `experimental.idle` (post-turn shave) + session watcher; tools
  `live_compact_status` / `live_compact_recall` (`lc1_<32hex>` refs);
  per-session archive dirs under a 256MiB budget. Their checkpoint
  fingerprint: `[Live Compact completed span … reference lc1_…]` +
  `[Live Compact omitted N …]` markers.

## Interim (VCC arm, session state)

- 5 rows at 91 msgs with clean cycle separation: row 1 (3395 chars)
  early YY; rows 3–4 (7179/7421 chars) mid YY; row 5 (1494 chars)
  late YY (6th row later: 7236 chars, mid+late YY cumulative).
  Each cycle's compaction preserves that cycle's needles;
  prior rows persist alongside (full-context survival via row stack).

## Interim (live-compact arm, session state)

- Turn 1: 5 msgs, ~14.2k in — near-identical to VCC turn 1 (13.7k).
- Turn 5: first host compaction, row is **host-native template**
  (no `lc1_` refs, no markers): their replacement hook did not
  replace, and zero idle shaves through 5 turns (no markers, no
  archive backups).
- Live window post-compaction ≈ 9.2k tokens — well under their 20k
  trigger. Working hypothesis: trigger-regime mismatch. The host's
  99% buffer fires native compactions that keep resetting the
  window below 20k, so their shaver never gets a turn.
- Turn 9: second host compaction, row is again **host-native
  template** (1485 chars, early YY + mid YY — the host summarizer
  restated both). Still zero Live Compact markers, zero archive
  backups: their cutter has not engaged through 9 turns.
  Trigger-mismatch hypothesis holds and hardens.
- Turn 13: 4 rows, 90 msgs, **all host-native** (latest 2187
  chars, early+mid YY via host summarizer). Zero `lc1_` refs,
  zero markers, zero archive backups through 13 turns. Late
  needles planted turn 13; no row covers them yet — continuation
  probe decides.

## Verdict (2026-11-21)

Both arms 18/18 turns. Continuation probes: **6/6 exact both
sides, 0 invented.** VCC `ses_e017ae34…`: 118 msgs, 7 rows (all
VCC checkpoints; latest 7220 chars mid+late YY). Live-compact
`ses_e0175d0f…`: 119 msgs, 6 rows (**all host-native**, latest
2660 chars YYYYYY via the host summarizer).

Headline: **Live Compact never engaged once.** Zero `lc1_` refs,
zero `[Live Compact …]` markers, zero archive backups across 18
turns, and the first host compaction went native instead of
their replacement. Their 20k live-window trigger never met: host
native compactions (99% buffer) kept resetting the window (≈9k
post-compaction), so the shaver never got a turn and the
replacement never had anything to replace.

What this pilot did and did not test:

- Tested: trigger-regime overlap on host-buffer-driven workloads
  — result: no overlap. Under aggressive host compaction their
  plugin is a passenger; the effective comparison was VCC
  checkpoints vs host-native rows (both preserved everything).
- NOT tested: their shaving quality itself. No evidence for or
  against it. A rematch that engages their cutter needs the live
  window past 20k between native compactions (higher host buffer,
  longer turns, or their threshold lowered via options).
- Growth curves (cumulative per-turn integrals, identical method):
  VCC 13.7k→319k with 6 checkpoints; live 14.2k→365k with 6
  native rows. Same shape — nothing shaved, nothing diverged.
- Harness-bias caveat (noted same day): our 99% host buffer is
  unusually aggressive — it fires native compactions early and
  often, which maximally starves a 20k live-window trigger. Under
  production host defaults (larger windows, rarer native fires)
  their cutter would get its turn. This pilot proves the mismatch
  regime exists, not that their shaving fails in it. The design
  critique that stands regardless: their value depends on winning
  a race against the host's own compaction without coordinating
  with it — two uncoordinated writers, and when native fires
  first they do nothing (their replacement hook let all six
  through native).

Bottom line: no reason to change our design or defaults. For
users on default host settings, Live Compact's default trigger
never fires — that is their tuning question, not our problem.
If a shave-vs-checkpoint quality fight is wanted, it needs a
workload built for their trigger. No benchmark needed beyond
this: survival is 6/6 both sides, cost is zero-model-call both
sides (their shaver is LLM-free too).
