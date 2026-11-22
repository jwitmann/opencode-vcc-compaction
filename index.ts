import { Plugin, Rpc } from "@opencode/plugin/effect"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import { Effect, Schema } from "effect"
import { buildConfig, compileCompaction } from "./adapter.mjs"
import { VCC_REPLY_EVENT, VCC_RPC_ID, buildReplyPayload } from "./events.mjs"
import {
  COMPILER_REV,
  MAX_SNAPSHOT_WRITE_BYTES,
  SNAPSHOT_KEY_PREFIX,
  WATCH_STATS_KEY_PREFIX,
  classifySnapshotStore,
  formatRecallReply,
  formatSearchReply,
  formatStatusText,
  parseRecallArgs,
  parseSearchArgs,
  recallFromSnapshot,
  resolveRecallSelections,
  retainSnapshotMessages,
  searchSnapshot,
  snapshotNeedsWrite,
  snapshotWriteBytes,
  updateWatchStats,
} from "./snapshot.mjs"

// opencode-vcc-compaction: deterministic LLM-free compaction summaries.
//
// The compaction hook adapts the request messages through adapter.mjs (pure
// offline mapping + the VCC reference compiler) and sets event.result so the
// host takes its fromHook short-circuit: no model call, tail rebuilt from
// metadata.keepID. When the adapter abstains (no message id at/after the
// keep cut), result stays unset and the host falls back to model compaction.
// Alongside, context + compaction hooks snapshot cleaned raw messages
// (snapshot.mjs: append-mode across compactions, retained newest-wins —
// `snapshotMaxMessages` 50 / `snapshotFullPayloadMessages` 20, tunable
// via options; growth-guarded by version/count/lastID, >1MB single-write
// warn tripwire + queryable per-session watch stats (`vcc-stats/` key:
// maxWriteBytes, tripCount), every failure path warn-and-continue) so the vcc-
// commands can recall/search history the command ctx cannot read directly.
//
// Effect-direct by owner decision: written against @opencode/plugin/effect
// from the start, so no convert-to-Effect task ever arises.
//
// Command replies travel as an RPC event the TUI companion toasts:
// the server emits `rpc.opencode-vcc-compaction.replied` and returns
// void with no prompt call (no wake, no chatter, no inbox row) — the
// goal-plugin pattern (`get` + event). Without the companion the
// event goes nowhere, and without RPC itself replies fall back to
// `session.prompt` (visible + wakes), so output is never lost.
// Payload shape shared with events.mjs (runtime single source of truth
// lives there for the dependency-free selftest; this alias only types
// the emit call site).
type ReplyPayload = { sessionID: string; command: string; text: string }

const VccRpc = Rpc.define({ id: VCC_RPC_ID,
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(
        Schema.NullOr(
          Schema.Struct({
            version: Schema.Number,
            messages: Schema.Array(Schema.Unknown),
            count: Schema.Number,
            lastID: Schema.optional(Schema.String),
            writtenAt: Schema.Number,
          }),
        ),
      ),
    },
  },
  events: {
    [VCC_REPLY_EVENT]: {
      schema: Schema.toStandardSchemaV1(
        Schema.Struct({ sessionID: Schema.String, command: Schema.String, text: Schema.String }),
      ),
    },
  },
})

export default Plugin.define({
  id: "opencode-vcc-compaction",
  effect: Effect.fn(function* (ctx) {
    const config = buildConfig(ctx.options)
    const seen = new Map<string, { version: number; count: number; lastID: string | undefined; messages: unknown; stats: unknown; statsLoaded: boolean }>()
    // Seen entries carry payloads (bounded by the retention cap), so the
    // map itself is bounded: cold-start re-read refills evicted sessions.
    const MAX_SEEN_SESSIONS = 20

    const readStored = (sessionID: string, label: string) =>
      Effect.catch(
        ctx.storage.get(`${SNAPSHOT_KEY_PREFIX}${sessionID}`),
        (error) =>
          Effect.sync(() => {
            console.warn(`[opencode-vcc-compaction] ${label}: snapshot read failed:`, error)
            return { __vccReadFailed: true as const }
          }),
      )

    // RPC registration must never break init: a JS try/catch around
    // yield* cannot intercept Effect failures, so catch the cause
    // channel explicitly and degrade to prompt replies.
    const rpc = yield* Effect.catchCause(
      ctx.rpc.register(VccRpc, {
        get: (input) =>
          Effect.flatMap(readStored(input.sessionID, "rpc.get"), (stored) => {
            const classified = classifySnapshotStore(stored as never)
            if (classified.status !== "ready") return Effect.succeed(null)
            const candidate = classified.stored as Partial<
              Record<"version" | "messages" | "count" | "lastID" | "writtenAt", unknown>
            >
            // The store only guarantees a non-empty messages array; project
            // the five schema fields (or null) instead of trusting the
            // envelope, so hand-written or older shapes fail soft.
            return Effect.succeed(
              typeof candidate.version === "number" &&
                Array.isArray(candidate.messages) &&
                typeof candidate.count === "number" &&
                typeof candidate.writtenAt === "number"
                ? {
                    version: candidate.version,
                    messages: candidate.messages,
                    count: candidate.count,
                    ...(typeof candidate.lastID === "string" ? { lastID: candidate.lastID } : {}),
                    writtenAt: candidate.writtenAt,
                  }
                : null,
            )
          }),
      }),
      (cause) =>
        Effect.flatMap(
          Effect.sync(() => {
            console.warn("[opencode-vcc-compaction] rpc unavailable; /vcc-* replies fall back to prompt:", cause)
          }),
          () => Effect.succeed(null),
        ),
    )
    const emitReply: ((payload: ReplyPayload) => Effect.Effect<void, unknown>) | null =
      rpc === null ? null : (payload) => rpc.events.emit(VCC_REPLY_EVENT, payload)

    // Primary path emits the reply event for the TUI companion (silent,
    // no wake). Fallbacks keep output visible: emit failure or missing
    // RPC revert to session.prompt (visible + wakes, 0.2.0 behavior).
    // The host passes `input.prompt` as `{ text }`; normalize a plain
    // string too so a host-shape change degrades to working, not to a
    // permanent usage error.
    const promptText = (input: { prompt: unknown }) =>
      typeof input.prompt === "string" ? input.prompt : ((input.prompt as { text?: unknown })?.text ?? "")

    const reply = (input: { sessionID: string; delivery?: SessionInbox.Delivery }, command: string, text: string) =>
      emitReply === null
        ? ctx.session.prompt({
            sessionID: input.sessionID,
            text,
            delivery: input.delivery,
          })
        : Effect.catch(
            emitReply(buildReplyPayload(input.sessionID, command, text)),
            (error) =>
              Effect.flatMap(
                Effect.sync(() => {
                  console.warn("[opencode-vcc-compaction] reply emit failed; falling back to prompt:", error)
                }),
                () =>
                  ctx.session.prompt({
                    sessionID: input.sessionID,
                    text,
                    delivery: input.delivery,
                  }),
              ),
          )

    const remember = (sessionID: unknown, messages: unknown) =>
      Effect.catch(
        Effect.flatMap(
          Effect.sync(() => {
            if (typeof sessionID !== "string" || sessionID === "") {
              console.warn("[opencode-vcc-compaction] snapshot skipped: missing sessionID")
              return null
            }
            return { key: sessionID, cached: seen.get(sessionID) }
          }),
          (started) => {
            if (started === null) return Effect.void
            const { key, cached } = started
            // Merge source for append-across-compactions: the in-memory
            // prefix when this session already wrote in this process
            // lifetime, else one storage read (cold start), else no merge.
            // Every failure path warn-and-continues with the fresh snapshot,
            // exactly like every other snapshot failure.
            const prevSource =
              cached !== undefined
                ? Effect.succeed({ messages: cached.messages })
                : Effect.catch(
                    Effect.map(
                      ctx.storage.get(`${SNAPSHOT_KEY_PREFIX}${key}`),
                      (stored) => {
                        // Reuse the command path's envelope parser so the
                        // stored shape is validated exactly once.
                        const parsed = classifySnapshotStore(stored)
                        if (parsed.status !== "ready")
                          return { messages: undefined as unknown }
                        return { messages: parsed.messages }
                      },
                    ),
                    (error) =>
                      Effect.sync(() => {
                        console.warn("[opencode-vcc-compaction] snapshot previous read failed:", error)
                        return { messages: undefined as unknown }
                      }),
                  )
            return Effect.flatMap(prevSource, (prev) => {
              const retained = retainSnapshotMessages(prev.messages, messages as never, {
                maxMessages: config.snapshotMaxMessages,
                fullPayloadMessages: config.snapshotFullPayloadMessages,
              })
              if (!snapshotNeedsWrite(cached, retained)) return Effect.void
              const at = Date.now()
              const envelope = {
                version: retained.version,
                messages: retained.messages,
                count: retained.count,
                ...(retained.lastID === undefined ? {} : { lastID: retained.lastID }),
                writtenAt: at,
              }
              const writeBytes = snapshotWriteBytes(envelope)
              // Watch stats live in their own kv key (not the envelope, so
              // recall/search/RPC readers never change shape): lazy-load once
              // per session, fold purely, persist only on new max or trip.
              const loadStats =
                cached?.statsLoaded === true
                  ? Effect.succeed(cached.stats)
                  : Effect.catch(
                      ctx.storage.get(`${WATCH_STATS_KEY_PREFIX}${key}`),
                      (error) =>
                        Effect.sync(() => {
                          console.warn("[opencode-vcc-compaction] watch stats read failed; folding from zero:", error)
                          return undefined
                        }),
                    )
              return Effect.catch(
                Effect.flatMap(loadStats, (storedStats) => {
                  const fold = updateWatchStats(storedStats, writeBytes, at)
                  const recordStats = fold.changed
                    ? Effect.catch(
                        ctx.storage.set(`${WATCH_STATS_KEY_PREFIX}${key}`, fold.stats),
                        (error) =>
                          Effect.sync(() => {
                            console.warn("[opencode-vcc-compaction] watch stats write failed:", error)
                          }),
                      )
                    : Effect.void
                  return Effect.flatMap(
                    writeBytes > MAX_SNAPSHOT_WRITE_BYTES
                      ? Effect.sync(() => {
                          console.warn(
                            `[opencode-vcc-compaction] snapshot write large: session ${sessionID} count=${retained.count} ~${writeBytes} bytes (retention bound exceeded; envelope should stay O(bound))`,
                          )
                        })
                      : Effect.void,
                    () =>
                      Effect.flatMap(
                        ctx.storage.set(`${SNAPSHOT_KEY_PREFIX}${key}`, envelope),
                        () =>
                          Effect.flatMap(recordStats, () =>
                            Effect.sync(() => {
                              seen.set(key, {
                                version: retained.version,
                                count: retained.count,
                                lastID: retained.lastID,
                                messages: retained.messages,
                                stats: fold.stats,
                                statsLoaded: true,
                              })
                            }),
                          ),
                      ),
                  )
                }),
                (error) =>
                  Effect.sync(() => {
                    console.warn("[opencode-vcc-compaction] snapshot write failed:", error)
                  }),
              )
            })
          },
        ),
        (error) =>
          Effect.sync(() => {
            console.warn("[opencode-vcc-compaction] snapshot build failed:", error)
          }),
      )

    // True when the context hook below registered: snapshots are then
    // maintained on every turn and the compaction hook can skip its own
    // rebuild. When false (host without a context hook), every
    // compaction must rebuild — `seen` presence alone would go stale
    // after the first compaction-time write.
    let snapshotsViaContext = false
    try {
      yield* ctx.session.hook("context", (event) =>
        remember((event as { sessionID: string }).sessionID, (event as { messages: unknown }).messages),
      )
      snapshotsViaContext = true
    } catch (error) {
      console.warn("[opencode-vcc-compaction] context hook unavailable; snapshots via compaction only:", error)
    }

    yield* ctx.session.hook("compaction", (event) =>
      Effect.flatMap(
        // Snapshots land via the context hook on every turn; rebuilding
        // the same append-only log here would duplicate that work once
        // per compaction. Skip only when the context path is proven
        // live (registered above AND this session already seen) —
        // otherwise rebuild, exactly as before.
        Effect.sync(
          () =>
            snapshotsViaContext && seen.has((event as { sessionID: string }).sessionID),
        ),
        (ready) =>
          Effect.flatMap(
            ready
              ? Effect.void
              : remember(
                  (event as { sessionID: string }).sessionID,
                  (event as { messages: unknown }).messages,
                ),
            () =>
              Effect.sync(() => {
            let outcome
            try {
              outcome = compileCompaction(event.messages, config)
            } catch (error) {
              console.warn("[opencode-vcc-compaction] adapter failed; leaving result unset:", error)
              return
            }
            if (outcome === undefined) {
              console.warn(
                "[opencode-vcc-compaction] adapter abstained (no message id at/after the keep cut); leaving result unset for host fallback",
              )
              return
            }
            if (outcome.stats.keptErrorWhole > 0) {
              console.warn(
                `[opencode-vcc-compaction] fail-open: kept ${outcome.stats.keptErrorWhole} error-diagnosis row(s) whole past the cap; successes were cut first`,
              )
            }
            event.result = {
              summary: outcome.summary,
              metadata: { keepID: outcome.keepID },
            }
          }),
        ),
      ),
    )

    try {
      yield* ctx.command.transform((editor) => {
        editor.add({
          name: "vcc-recall",
          description: "Restore exact original content from this session by (seq N), result, or checkpoint reference.",
          execute: (input) =>
            Effect.catchCause(
              Effect.flatMap(
                Effect.sync(() => parseRecallArgs(promptText(input))),
                (parsed) => {
                  if ("error" in parsed) {
                    return reply(input, "/vcc-recall", `**/vcc-recall** — ${parsed.error}`)
                  }
                  return Effect.flatMap(
                    readStored(input.sessionID, "vcc-recall"),
                    (stored) => {
                      const classified = classifySnapshotStore(stored as never)
                      if (classified.status === "failed") {
                        return reply(input, "/vcc-recall", "**/vcc-recall** — snapshot read failed, try again in a moment")
                      }
                      if (classified.status === "empty") {
                        console.log("[opencode-vcc-compaction] vcc-recall: no snapshot yet for this session")
                        return Effect.void
                      }
                      const resolved = resolveRecallSelections(classified.messages as never, parsed.type, parsed.id)
                      if (resolved.errors.length > 0 || resolved.selections.length === 0) {
                        return reply(
                          input,
                          "/vcc-recall",
                          `**/vcc-recall** — ${resolved.errors.join("; ") || "nothing to recall"}`,
                        )
                      }
                      const recalled = recallFromSnapshot(classified.messages as never, resolved.selections)
                      return reply(input, "/vcc-recall", formatRecallReply(parsed.type, parsed.id, recalled as never))
                    },
                  )
                },
              ),
              (cause) =>
                Effect.catchCause(
                  ctx.session.prompt({
                    sessionID: input.sessionID,
                    text: "**/vcc-recall** — command failed, try again in a moment",
                    delivery: input.delivery,
                  }),
                  () =>
                    Effect.sync(() => {
                      console.warn("[opencode-vcc-compaction] vcc-recall failed:", cause)
                    }),
                ),
            ),
        })
        editor.add({
          name: "vcc-search",
          description: "Search this session's history by keyword or regex; returns (seq N) hits for /vcc-recall.",
          execute: (input) =>
            Effect.catchCause(
              Effect.flatMap(
                Effect.sync(() => parseSearchArgs(promptText(input))),
                (parsed) => {
                  if ("error" in parsed) {
                    return reply(input, "/vcc-search", `**/vcc-search** — ${parsed.error}`)
                  }
                  return Effect.flatMap(
                    readStored(input.sessionID, "vcc-search"),
                    (stored) => {
                      const classified = classifySnapshotStore(stored as never)
                      if (classified.status === "failed") {
                        return reply(input, "/vcc-search", "**/vcc-search** — snapshot read failed, try again in a moment")
                      }
                      if (classified.status === "empty") {
                        console.log("[opencode-vcc-compaction] vcc-search: no snapshot yet for this session")
                        return Effect.void
                      }
                      let found
                      try {
                        found = searchSnapshot(classified.messages as never, parsed.pattern)
                      } catch (error) {
                        return reply(
                          input,
                          "/vcc-search",
                          `**/vcc-search** — ${error instanceof Error ? error.message : String(error)}`,
                        )
                      }
                      return reply(input, "/vcc-search", formatSearchReply(parsed.pattern, found as never))
                    },
                  )
                },
              ),
              (cause) =>
                Effect.catchCause(
                  ctx.session.prompt({
                    sessionID: input.sessionID,
                    text: "**/vcc-search** — command failed, try again in a moment",
                    delivery: input.delivery,
                  }),
                  () =>
                    Effect.sync(() => {
                      console.warn("[opencode-vcc-compaction] vcc-search failed:", cause)
                    }),
                ),
            ),
        })
        editor.add({
          name: "vcc-status",
          description: "Show opencode-vcc-compaction engine revision, config, and snapshot freshness.",
          execute: (input) =>
            Effect.catchCause(
              Effect.flatMap(
                readStored(input.sessionID, "vcc-status"),
                (stored) => {
                  const classified = classifySnapshotStore(stored as never)
                  if (classified.status === "failed") {
                    return reply(input, "/vcc-status", "**/vcc-status** — snapshot read failed, try again in a moment")
                  }
                  return reply(
                    input,
                    "/vcc-status",
                    formatStatusText(
                      classified.status === "ready" ? classified.stored as never : undefined,
                      config as never,
                      COMPILER_REV as string,
                      Date.now(),
                    ),
                  )
                },
              ),
              (cause) =>
                Effect.catchCause(
                  ctx.session.prompt({
                    sessionID: input.sessionID,
                    text: "**/vcc-status** — command failed, try again in a moment",
                    delivery: input.delivery,
                  }),
                  () =>
                    Effect.sync(() => {
                      console.warn("[opencode-vcc-compaction] vcc-status failed:", cause)
                    }),
                ),
            ),
        })
      })
    } catch (error) {
      console.warn("[opencode-vcc-compaction] command API unavailable; /vcc-* commands not registered:", error)
    }
  }),
})
