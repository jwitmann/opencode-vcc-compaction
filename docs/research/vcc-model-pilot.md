# Pilot: VCC vs compaction-model (single fight)

**Status:** round 2 running (VCC: fresh absolute-path harness;
contender: default summarizer).
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

| | VCC side | model side |
|---|---|---|
| Summary chars | | |
| N1–N5 (each: verbatim / recall / paraphrase / invented / missing) | | |
| Continuation | pass / fail | pass / fail |
| Row usage fields | present / absent | present / absent |
| Metadata keys | | |
| Wall latency (compaction turn) | | |
