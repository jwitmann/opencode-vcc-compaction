import { Plugin, Rpc } from "@opencode/plugin/effect"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import { Effect, Schema } from "effect"
import { buildConfig, compileCompaction } from "./adapter.mjs"
import { VCC_REPLY_EVENT, VCC_RPC_ID, buildReplyPayload } from "./events.mjs"
import {
  COMPILER_REV,
  SNAPSHOT_KEY_PREFIX,
  buildSnapshot,
  classifySnapshotStore,
  formatRecallReply,
  formatSearchReply,
  formatStatusText,
  parseRecallArgs,
  parseSearchArgs,
  recallFromSnapshot,
  resolveRecallSelections,
  searchSnapshot,
  snapshotNeedsWrite,
} from "./snapshot.mjs"

// opencode-vcc-compaction: deterministic LLM-free compaction summaries.
//
// The compaction hook adapts the request messages through adapter.mjs (pure
// offline mapping + the VCC reference compiler) and sets event.result so the
// host takes its fromHook short-circuit: no model call, tail rebuilt from
// metadata.keepID. When the adapter abstains (no message id at/after the
// keep cut), result stays unset and the host falls back to model compaction.
// Alongside, context + compaction hooks snapshot cleaned raw messages
// (snapshot.mjs, growth-guarded by version/count/lastID, warn-and-continue)
// so the vcc- commands can recall/search history the command ctx cannot
// read directly.
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
    const seen = new Map<string, { version: number; count: number; lastID: string | undefined }>()

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
            return buildSnapshot(messages as never)
          }),
          (snap) => {
            if (snap === null) return Effect.void
            const prev = seen.get(sessionID as string)
            if (!snapshotNeedsWrite(prev, snap)) return Effect.void
            return Effect.catch(
              Effect.flatMap(
                ctx.storage.set(`${SNAPSHOT_KEY_PREFIX}${sessionID}`, {
                  version: snap.version,
                  messages: snap.messages,
                  count: snap.count,
                  ...(snap.lastID === undefined ? {} : { lastID: snap.lastID }),
                  writtenAt: Date.now(),
                }),
                () =>
                  Effect.sync(() => {
                    seen.set(sessionID as string, {
                      version: snap.version,
                      count: snap.count,
                      lastID: snap.lastID,
                    })
                  }),
              ),
              (error) =>
                Effect.sync(() => {
                  console.warn("[opencode-vcc-compaction] snapshot write failed:", error)
                }),
            )
          },
        ),
        (error) =>
          Effect.sync(() => {
            console.warn("[opencode-vcc-compaction] snapshot build failed:", error)
          }),
      )

    try {
      yield* ctx.session.hook("context", (event) =>
        remember((event as { sessionID: string }).sessionID, (event as { messages: unknown }).messages),
      )
    } catch (error) {
      console.warn("[opencode-vcc-compaction] context hook unavailable; snapshots via compaction only:", error)
    }

    yield* ctx.session.hook("compaction", (event) =>
      Effect.flatMap(
        remember((event as { sessionID: string }).sessionID, (event as { messages: unknown }).messages),
        () =>
          Effect.sync(() => {
            let outcome
            try {
              outcome = compileCompaction(event.messages, config)
            } catch (error) {
              console.warn("[opencode-vcc-compaction] adapter failed; leaving result unset:", error)
              return
            }
            if (outcome === undefined) return
            event.result = {
              summary: outcome.summary,
              metadata: { keepID: outcome.keepID },
            }
          }),
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
