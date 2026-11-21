# Architecture review — opencode-vcc-compaction 0.3.0 (2026-11-19)

Question: did we design this the best way? Method: lead-measured
benchmarks + two delegated read-only analyses (hot path + store/Effect;
bridge + TUI + packaging). Verdict: **keep the architecture**, one
small change (implemented, see §5), two watches.

## 1. Measured numbers (lead, synthetic sessions)

- `compileCompaction` output is window-bounded (~620-char summary at
  n=50..2000) but CPU walks all n (`toNode` loop + `compileNodes`
  pre-pass): O(n) CPU, O(window) bytes. Runs ~once per compaction, so
  single-digit ms even at n=8000 — correct the mental model, not the code.
- `buildSnapshot` full rebuild per message event: ~0.9ms @ n=2000,
  ~3.3ms @ n=8000. Snapshot JSON ~160 bytes/msg (1.3MB @ n=8000).
- `remember` sits on the hook critical path (host awaits hook Effects)
  but is ~0.1% of an LLM turn. Invisible below n≈10k; watch at
  n≈10–25k (≈10ms/turn, ≈4MB writes); consider incremental appends
  beyond n≈25k or on constrained disks.
- Write amplification is O(n²) lifetime bytes (~10GB @ n=8000 with
  filler-size messages): full envelope rewritten whenever lastID
  advances (every real turn). No correctness risk (atomic single-key
  envelope, fail-soft classification); a durability/wear smell only.

## 2. Keep (verified, no action)

- **Push beats pull**: TUI stays a 24-line dumb renderer; one
  formatting authority; bus cap enforced server-side. `rpc.get` is a
  harmless extension point.
- **Companion-absent silence + fallback ladder** (emit→prompt,
  no-RPC→prompt, catastrophic→prompt-or-warn): output never lost.
- **Listener cost**: one property access + string `!==` vs hoisted
  constant per bus event; zero allocation on miss path. Negligible.
- **Effect v4 proportionate**: `catch` (recoverable: storage, emit) vs
  `catchCause` (registration, command bodies) correctly layered;
  config built once at init; schemas at registration only.
- **`seen` map**: ~200B/session, self-healing on miss. No eviction needed.
- **Vendoring gate**: ~70 lines, zero deps, ms checks; buys tarball
  self-containment + verbatim-port discipline. A real dep would add
  skew for no gain at this scale.

## 3. Watch (no code)

- **O(n²) writes** (see §1 thresholds). Deferred per owner: revisit
  when real sessions approach n≈25k. Note the fast-path trap: a
  raw-length pre-check only helps no-growth turns, which never happen
  (every turn appends) — the real fix then is incremental append.
- **Multi-session toast attribution unenforced**: every companion
  toasts every session's replies. Harmless single-session (live-proven
  2026-11-19); check whether TUI ctx exposes a session ID, else
  declare "broadcast by design".

## 4. Notes (recorded, unchanged)

- `tui-shims.d.ts`: add expiry note ("remove when `@opencode/theme`
  ships types") — still open, trivial.
- Empty-snapshot recall/search silence: defensible, slightly
  undiscoverable; `vcc-status` handles it well already.
- Dialog `set`-after-`alert` follows the ODF precedent; title
  `vcc /vcc-*` cosmetic.
- Staleness (not tearing) is the read model: atomic envelope +
  fail-soft classification; `formatStatusText` surfaces snapshot age.

## 5. Implemented: drop redundant compaction-hook rebuild

`vcc-plugin/index.ts` compaction hook no longer unconditionally runs
`remember(...)` before compiling — the context hook already
snapshotted the same append-only log. Skip gate:
`snapshotsViaContext && seen.has(sessionID)` (a `let` set true only
when the context hook registers). Skip saves one O(n) build per
compaction (~3ms @ n=8000); otherwise rebuild, exactly as before —
including every compaction when the context hook is unavailable, so
the degraded path cannot go stale (correctness review caught the
naive seen-only gate diverging after the first compaction-time
write; fixed before commit). Battery green (`node --check`,
`npm run typecheck/test`, `lint:md`).

## 6. Review status

- style+pattern (`review-hook-style`): PASS; 2 nits (redundant cast,
  continuation indent) applied, typecheck re-green.
- correctness (`review-hook-correct`): PASS after fix — 1 Blocking
  (seen-only gate stale in context-unavailable path) fixed via the
  `snapshotsViaContext` availability gate; flattening, races, and
  undefined-sessionID handling verified correct.
- framework pattern-38/40: no drift. framework code-39: clean
  (3 known notes: dead `snap === null`, `seen` growth, gate safety).

## 7. Interim real-session data (2026-11-19, evening; final revisit pending)

- Live host `kv` shows the working session at 92 cleaned messages /
  ~493KB snapshot ≈ **5.4KB/message — ~30× the 160B/message synthetic
  filler** behind the §1 thresholds. Drivers: 45 tool-call/result pairs
  (full result JSON) + 30 stored reasoning blocks.
- Consequence: the 1MB-per-write mark arrives at **~185 messages**, not
  thousands; lifetime-bytes math is 30× worse than §1 too. The working
  session (phases 3–4 still to come) will cross 1MB, becoming the
  empirical ceiling probe.
- Implemented: `MAX_SNAPSHOT_WRITE_BYTES` (1MB) + `snapshotWriteBytes`
  in `snapshot.mjs`, warn-and-continue tripwire in `remember`
  (`index.ts`), 4 selftest vectors. Battery green.
- Open: drop reasoning blocks from the snapshot (they are ~⅓ of parts;
  recall fidelity vs size)? Final numbers + decision after this session
  ends.

## 8. Final real-session data (2026-11-20; phases 3–4 done, session live)

Session `ses_e7eaa04d` ("Improvements and next steps", operator-memory):

- 9037 message rows: 342 user / 3666 assistant / 2290 compaction /
  2638 idle / 76 synthetic / 18 system / 6 model-switched /
  1 agent-switched. The 2290 compaction rows confirm the lifecycle:
  `remember` rebuilds the snapshot from the live log each turn, and
  each host compaction truncates the log — so snapshot size tracks
  the *inter-compaction window*, not lifetime. Post-compaction the
  snapshot is 5 cleaned messages / 45,559 bytes.
- Real density holds across sessions: peak survivors 195KB@34 msgs
  (5.7KB/msg, "Review recall/search port"), 185KB@30 (6.2KB/msg),
  177KB@40 (4.4KB/msg) — all operator-memory review sessions. Rule
  of thumb stands: **~4.5–6KB per cleaned message**, so the 1MB
  single-write mark sits at **~160–220 inter-compaction messages**.
- Tripwire (1MB) has no surviving breach: max snapshot on disk is
  195KB. But absence is unverifiable two ways: (a) a transient
  >1MB peak between compactions leaves no kv trace (rebuild shrinks
  it); (b) plugin `console.warn` never reaches `opencode.log`
  (0 plugin lines in 27MB of host log), so "0 firings in the log"
  proves nothing about whether it fired.

## 9. Decision: tripwire suffices; incremental parked; reasoning kept

- **No incremental appends.** Per-write size is self-limiting via
  host compaction cadence (empirical ceiling ~493KB interim peak,
  ~195KB max survivor, both <1MB at ~2× headroom). Lifetime-bytes
  O(n²) remains, but it is a wear smell, not a correctness or
  latency risk at these sizes. Revisit only on an observed >1MB
  write.
- **Keep reasoning blocks.** They are ~⅓ of parts at peak but bytes-
  small outside tool-result-heavy stretches (66B of 45KB
  post-compaction); dropping them would trade recall fidelity — the
  feature's whole point — for a fraction of a ~200KB envelope.
- **Recommended next step (separate task, needs owner sign-off):**
  make tripwire firings queryable — e.g. record `maxWriteBytes` /
  `lastTripwireAt` in the envelope or a kv counter. Today a firing
  is visible only on live TUI stderr, so the next revisit would be
  evidence-blind again. Small product-behavior change: do not bundle
  silently, propose first.
- **Implemented 2026-11-20 (owner-approved same day):** per-session
  `vcc-stats/<sessionID>` kv (`version`, `maxWriteBytes`, `maxAt`,
  `tripCount`, `lastTripwireAt`), folded purely by
  `updateWatchStats` (snapshot.mjs) and persisted by `remember`
  only on new max or trip — lazy-loaded once per session into the
  `seen` entry, every failure path warn-and-continue. Envelope,
  recall/search/RPC readers unchanged. Next revisit queries
  `kv WHERE key LIKE '%:vcc-stats/%'` instead of inferring from
  survivors.

- **Implemented 2026-11-21 (owner-approved same day):** append-mode
  snapshots with a retention bound. `remember` merges each fresh
  snapshot with the stored prefix (id-union in `mergeSnapshotMessages`,
  no anchor), then retains newest-wins (`SNAPSHOT_MAX_MESSAGES=50`,
  tool payloads age out past newest
  `SNAPSHOT_FULL_PAYLOAD_MESSAGES=20` to `result:null` + `aged:true`).
  Both bounds are config (`snapshotMaxMessages`,
  `snapshotFullPayloadMessages`, defaults 50/20); per-turn rewrite is
  O(bound), so the §3 O(n²) watch keeps meaning "exceptional". `seen`
  entries now carry payloads (bounded by the cap) and the map is
  FIFO-evicted at 20 sessions (`MAX_SEEN_SESSIONS`) — the old
  "~200B/session, no eviction needed" line above is superseded;
  cold-start storage re-read refills evicted sessions.

- **Boundary vs upstream dsh-compaction-vcc@0.7.4 (noted 2026-11-21,
  no action):** `engine/` (tokenize/compile/recall/search/
  session-compat) is the verbatim port; everything else is ours.
  `keepID` / the keep-cut abstain, the snapshot store + retention
  bound, the Effect hook wiring, `/vcc-*` commands, RPC/TUI exist
  only because the OpenCode host truncates history — the DSH
  harness keeps a durable append-only log, so upstream has neither
  the O(n²) store problem nor the abstain path. Nothing found in
  this pilot transfers upstream as a report.
