import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { buildConfig, compileCompaction } from "./adapter.mjs"

// opencode-vcc-compaction: deterministic LLM-free compaction summaries.
//
// The hook adapts the request messages through adapter.mjs (pure offline
// mapping + the VCC reference compiler) and sets event.result so the host
// takes its fromHook short-circuit: no model call, tail rebuilt from
// metadata.keepID. When the adapter abstains (no message id at/after the
// keep cut), result stays unset and the host falls back to model compaction.
//
// Effect-direct by owner decision: written against @opencode/plugin/effect
// from the start, so no convert-to-Effect task ever arises.

export default Plugin.define({
  id: "opencode-vcc-compaction",
  effect: Effect.fn(function* (ctx) {
    const config = buildConfig(ctx.options)

    yield* ctx.session.hook("compaction", (event) =>
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
    )
  }),
})
