/**
 * Cross-version session-log access, ported from
 * dsh-compaction-vcc@0.7.4 `src/session-compat.js` (MIT:
 * Copyright (c) 2026 TsFreddie, Copyright (c) 2026 Tingfeng).
 *
 * Implied dependency of the recall/search stages: `recall.mjs` imports
 * `sessionEventAt` / `sessionEvents` from here, exactly as upstream
 * `recall.js` imports them from `./session-compat.js`. Carried as its own
 * file (see the `docs/plans/vcc-compiler.md` module map) rather than
 * inlined, so the recall port stays line-for-line verbatim. Duck-typed accessors
 * (`eventAt`/`snapshotEvents`) with legacy `events`-array fallback — no
 * DSH imports, so the OpenCode adapter can supply any session-shaped value.
 *
 * Upstream semicolons kept verbatim, per the repo `.mjs` convention
 * (see `compiler/compile.mjs` header).
 *
 * Everything below is deterministic and offline.
 */
/** @type {Set<string>} Capability gaps already reported, so the log stays readable. */
const warned = new Set();

/**
 * Report a missing session capability exactly once per documented key.
 * @param message - human-readable warning body.
 */
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  try {
    console.warn(`[dsh-compaction-vcc] ${message}`);
  } catch {
    /* stderr may be unavailable in embedded contexts */
  }
}

/**
 * Report whether a session-shaped value exposes any readable event log.
 *
 * Exported so an engine can probe once at construction instead of discovering
 * the gap in the middle of a compaction.
 * @param session - session-shaped value to inspect.
 * @returns true when `snapshotEvents`, `eventAt` or the legacy `events` exists.
 */
export function hasSessionEventAccess(session) {
  if (session === null || session === undefined) return false;
  if (typeof session.snapshotEvents === "function") return true;
  if (typeof session.eventAt === "function") return true;
  return session.events !== null && session.events !== undefined;
}

/**
 * Return a frozen snapshot of every event in the durable log.
 * @param session - session-shaped value with `snapshotEvents()` or legacy `events`.
 * @returns the frozen event array; empty only when the session genuinely has
 * no log access, which is reported once through `console.warn`.
 */
export function sessionEvents(session) {
  if (session === null || session === undefined) return [];
  if (typeof session.snapshotEvents === "function") {
    const events = session.snapshotEvents();
    if (events === null || events === undefined) {
      warnOnce("snapshotEvents() returned no array; treating the log as empty");
      return [];
    }
    return events;
  }
  if (session.events !== null && session.events !== undefined) return session.events;
  warnOnce("session exposes neither snapshotEvents() nor events; the durable log is unreadable on this host — compaction will not run");
  return [];
}

/**
 * Return the immutable event stored at one exact sequence number.
 * @param session - session-shaped value with `eventAt()` or legacy `events`.
 * @param seq - event sequence number.
 * @returns the accepted event, or undefined when the log does not contain it.
 */
export function sessionEventAt(session, seq) {
  if (session === null || session === undefined) return undefined;
  if (typeof session.eventAt === "function") {
    const event = session.eventAt(seq);
    return event === null ? undefined : event;
  }
  const events = session.events;
  if (events === null || events === undefined) return undefined;
  // ⚠️ The legacy array is indexed by POSITION, not by seq: the durable log
  // numbers events from 1 while array indices start at 0, so `events[seq]` is
  // off by one. Every call site re-checks `event.seq === seq` and treats a
  // mismatch as "not found", so this is a safe failure rather than wrong data —
  // but it means the legacy path only works for a 0-based array. Prefer the
  // accessor pair; this branch exists for old unit fixtures.
  const positional = events[seq];
  if (positional !== undefined && positional?.seq === seq) return positional;
  for (const event of events) {
    if (event?.seq === seq) return event;
  }
  return positional;
}
