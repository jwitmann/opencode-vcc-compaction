import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { buildConfig, compileCompaction } from "./adapter.mjs"
import { SNAPSHOT_KEY_PREFIX, buildSnapshot, snapshotNeedsWrite } from "./snapshot.mjs"

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
  }),
})
