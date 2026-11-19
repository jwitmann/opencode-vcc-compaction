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
