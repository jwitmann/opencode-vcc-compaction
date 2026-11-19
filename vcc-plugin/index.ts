import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { buildConfig, compileCompaction } from "./adapter.mjs"
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

export default Plugin.define({
  id: "opencode-vcc-compaction",
  effect: Effect.fn(function* (ctx) {
    const config = buildConfig(ctx.options)
    const seen = new Map<string, { version: number; count: number; lastID: string | undefined }>()

    const remember = (sessionID: unknown, messages: unknown) =>
      Effect.catchAll(
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
            return Effect.catchAll(
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
            Effect.catchAllCause(
              Effect.flatMap(
                Effect.sync(() => parseRecallArgs((input.prompt as { text?: unknown })?.text ?? "")),
                (parsed) => {
                  if ("error" in parsed) {
                    return ctx.session.prompt({
                      sessionID: input.sessionID,
                      text: `**/vcc-recall** — ${parsed.error}`,
                      delivery: input.delivery,
                    })
                  }
                  return Effect.flatMap(
                    Effect.catchAll(
                      ctx.storage.get(`${SNAPSHOT_KEY_PREFIX}${input.sessionID}`),
                      (error) =>
                        Effect.sync(() => {
                          console.warn("[opencode-vcc-compaction] vcc-recall: snapshot read failed:", error)
                          return { __vccReadFailed: true as const }
                        }),
                    ),
                    (stored) => {
                      const classified = classifySnapshotStore(stored as never)
                      if (classified.status === "failed") {
                        return ctx.session.prompt({
                          sessionID: input.sessionID,
                          text: "**/vcc-recall** — snapshot read failed, try again in a moment",
                          delivery: input.delivery,
                        })
                      }
                      if (classified.status === "empty") {
                        console.log("[opencode-vcc-compaction] vcc-recall: no snapshot yet for this session")
                        return Effect.void
                      }
                      const resolved = resolveRecallSelections(classified.messages as never, parsed.type, parsed.id)
                      if (resolved.errors.length > 0 || resolved.selections.length === 0) {
                        return ctx.session.prompt({
                          sessionID: input.sessionID,
                          text: `**/vcc-recall** — ${resolved.errors.join("; ") || "nothing to recall"}`,
                          delivery: input.delivery,
                        })
                      }
                      const recalled = recallFromSnapshot(classified.messages as never, resolved.selections)
                      return ctx.session.prompt({
                        sessionID: input.sessionID,
                        text: formatRecallReply(parsed.type, parsed.id, recalled as never),
                        delivery: input.delivery,
                      })
                    },
                  )
                },
              ),
              (cause) =>
                Effect.sync(() => {
                  console.warn("[opencode-vcc-compaction] vcc-recall failed:", cause)
                }),
            ),
        })
        editor.add({
          name: "vcc-search",
          description: "Search this session's history by keyword or regex; returns (seq N) hits for /vcc-recall.",
          execute: (input) =>
            Effect.catchAllCause(
              Effect.flatMap(
                Effect.sync(() => parseSearchArgs((input.prompt as { text?: unknown })?.text ?? "")),
                (parsed) => {
                  if ("error" in parsed) {
                    return ctx.session.prompt({
                      sessionID: input.sessionID,
                      text: `**/vcc-search** — ${parsed.error}`,
                      delivery: input.delivery,
                    })
                  }
                  return Effect.flatMap(
                    Effect.catchAll(
                      ctx.storage.get(`${SNAPSHOT_KEY_PREFIX}${input.sessionID}`),
                      (error) =>
                        Effect.sync(() => {
                          console.warn("[opencode-vcc-compaction] vcc-search: snapshot read failed:", error)
                          return { __vccReadFailed: true as const }
                        }),
                    ),
                    (stored) => {
                      const classified = classifySnapshotStore(stored as never)
                      if (classified.status === "failed") {
                        return ctx.session.prompt({
                          sessionID: input.sessionID,
                          text: "**/vcc-search** — snapshot read failed, try again in a moment",
                          delivery: input.delivery,
                        })
                      }
                      if (classified.status === "empty") {
                        console.log("[opencode-vcc-compaction] vcc-search: no snapshot yet for this session")
                        return Effect.void
                      }
                      let found
                      try {
                        found = searchSnapshot(classified.messages as never, parsed.pattern)
                      } catch (error) {
                        return ctx.session.prompt({
                          sessionID: input.sessionID,
                          text: `**/vcc-search** — ${error instanceof Error ? error.message : String(error)}`,
                          delivery: input.delivery,
                        })
                      }
                      return ctx.session.prompt({
                        sessionID: input.sessionID,
                        text: formatSearchReply(parsed.pattern, found as never),
                        delivery: input.delivery,
                      })
                    },
                  )
                },
              ),
              (cause) =>
                Effect.sync(() => {
                  console.warn("[opencode-vcc-compaction] vcc-search failed:", cause)
                }),
            ),
        })
        editor.add({
          name: "vcc-status",
          description: "Show opencode-vcc-compaction engine revision, config, and snapshot freshness.",
          execute: (input) =>
            Effect.catchAllCause(
              Effect.flatMap(
                Effect.flatMap(
                  Effect.catchAll(
                    ctx.storage.get(`${SNAPSHOT_KEY_PREFIX}${input.sessionID}`),
                    (error) =>
                      Effect.sync(() => {
                        console.warn("[opencode-vcc-compaction] vcc-status: snapshot read failed:", error)
                        return { __vccReadFailed: true as const }
                      }),
                  ),
                  (stored) => {
                    const classified = classifySnapshotStore(stored as never)
                    if (classified.status === "failed") {
                      return ctx.session.prompt({
                        sessionID: input.sessionID,
                        text: "**/vcc-status** — snapshot read failed, try again in a moment",
                        delivery: input.delivery,
                      })
                    }
                    return ctx.session.prompt({
                      sessionID: input.sessionID,
                      text: formatStatusText(
                        classified.status === "ready" ? classified.stored as never : undefined,
                        config as never,
                        COMPILER_REV as string,
                        Date.now(),
                      ),
                      delivery: input.delivery,
                    })
                  },
                ),
              ),
              (cause) =>
                Effect.sync(() => {
                  console.warn("[opencode-vcc-compaction] vcc-status failed:", cause)
                }),
            ),
        })
      })
    } catch (error) {
      console.warn("[opencode-vcc-compaction] command API unavailable; /vcc-* commands not registered:", error)
    }
  }),
})
