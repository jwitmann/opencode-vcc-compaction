# Pilot: VCC vs compaction-model (single fight)

**Status:** prep (harnesses + script committed; runs need the live turns below).
**Base:** host `opencode v2.3.2`, `@opencode/plugin 2.3.2`, `effect 4.1.0`.
Ours `opencode-vcc-compaction@0.3.3` (`examples/`: maxTokens 2000,
keepMessages 4, buffer 99%). Theirs
`@madsoftwaredev/opencode-compaction-model@0.1.3` (`examples-model/`:
summarizer = working model, buffer 99% — recorded deviation from their
default `opencode-go/deepseek-v4.1-flash#max`; rationale: availability +
reproducibility on this host).
Working model both sides: `opencode-go/muse-spark-1.3-contributor`.

## Harnesses

- `examples/` — VCC side (existing scratch project, Brain-free).
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

## Result: VOID (plugins never loaded — control baseline only)

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

Diagnosis (same session): `/vcc-status` force-probe twice returned
`COMMAND MISSING` — including in a fresh session after touching
`examples/opencode.jsonc` (reload did not help). Standalone
`--print-logs` shows why: `failed to load plugin target=..` —
`FileSystem.makeDirectory (~/.local/state/...)` PermissionDenied under
this sandbox. With `XDG_*HOME=/tmp/...` the plugin loads standalone
(`loading plugin id=..`), but standalone has no model auth
(`ModelUnavailableError`), and the background service's log
(`~/.local/share/opencode/log`) is unreadable from this sandbox, so the
service-side load failure cannot be debugged here.

Value banked: harness parity (identical trigger timing), scripts +
needles + scorecard ready, control-baseline rows for "no plugin".
The real fight needs an unsandboxed terminal (plugin install + model
auth both require real HOME paths).

| | VCC side | model side |
|---|---|---|
| Summary chars | | |
| N1–N5 (each: verbatim / recall / paraphrase / invented / missing) | | |
| Continuation | pass / fail | pass / fail |
| Row usage fields | present / absent | present / absent |
| Metadata keys | | |
| Wall latency (compaction turn) | | |
