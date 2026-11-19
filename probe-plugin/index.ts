import { Plugin } from "@opencode/plugin"
import { appendFileSync } from "node:fs"

// Branch A/B probe — see ../docs/archive/PROBE.md.
//
// Branch A (default): set event.result to a deterministic marker summary with
// metadata.keepID = first message ID (whole tail kept), so the host must take
// fromHook() with no model call. A "model.request" hook with kind =
// "compaction" fires at request-build time (before the result check), so it is
// NOT proof of a call; only an "http.request" hook firing means the provider
// was really reached. Branch B (control): mutate system only, leave
// messages/result intact.
//
// The runner launches opencode with cwd=probe-project and exports:
// VCC_PROBE_BRANCH (A|B), VCC_PROBE_OPENCODE_VERSION,
// VCC_PROBE_PLUGIN_VERSION. Every recorded line carries versions per
// AGENTS.md; the schema matches probe-results/compaction-result-override.jsonl
// (see scripts/verify-evidence.mjs).
const MARKER = "VCC-PROBE-MARKER-12345"
const RESULTS_FILE =
  process.env.VCC_PROBE_RESULTS
    ?? "../probe-results/compaction-result-override.jsonl"

function record(branch: string, observation: string) {
  // Evidence must never break the probed behavior: a bad results path
  // degrades to a console line, never a throw into host hook dispatch.
  try {
    appendFileSync(
      RESULTS_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        opencodeVersion: process.env.VCC_PROBE_OPENCODE_VERSION ?? "unknown",
        pluginVersion: process.env.VCC_PROBE_PLUGIN_VERSION ?? "unknown",
        branch,
        observation,
      }) + "\n"
    )
  } catch {
    // No property access on the error: even a getter read could throw
    // inside this catch and propagate into host hook dispatch.
    console.log("[vcc-probe] record FAILED")
  }
}

export default Plugin.define({
  id: "vcc-probe",
  async setup(ctx) {
    const branch = process.env.VCC_PROBE_BRANCH ?? "A"
    if (!process.env.VCC_PROBE_OPENCODE_VERSION
      || !process.env.VCC_PROBE_PLUGIN_VERSION) {
      console.log("[vcc-probe] WARNING: version env unset, lines record unknown")
    }

    await ctx.session.hook("model.request", (event: any) => {
      if (event?.kind !== "compaction") return
      // Construction-time signal: prepare() triggers this hook while
      // building the request, BEFORE deliver() checks event.result
      // (model-request.ts:361 vs compaction.ts:635). Fires on the
      // short-circuit path too — not proof of a provider call.
      const msg = "model.request kind=compaction (request built; call unproven)"
      console.log("[vcc-probe]", msg)
      record(branch, msg)
    })

    await ctx.session.hook("http.request", (event: any) => {
      if (event?.kind !== "compaction") return
      // True network discriminator: only a real provider stream reaches here.
      // Expect zero such lines on the Branch A short-circuit path.
      const msg = "http.request kind=compaction observed (real provider call)"
      console.log("[vcc-probe]", msg)
      record(branch, msg)
    })

    await ctx.session.hook("compaction", (event: any) => {
      // PROBE.md: log full shape first.
      const keys = Object.keys(event ?? {})
      const optKeys = Object.keys(event?.options ?? {})
      const shapeMessages =
        Array.isArray(event?.messages) ? event.messages : []
      const sysCount = Array.isArray(event?.system) ? event.system.length : -1
      console.log("[vcc-probe] compaction keys:", keys.join(","))
      console.log("[vcc-probe] option keys:", optKeys.join(","))
      console.log(
        "[vcc-probe] system parts:",
        sysCount,
        "messages:",
        shapeMessages.length
      )
      for (const m of shapeMessages) {
        console.log("[vcc-probe] msg role/id:", m?.role, m?.id)
      }

      if (branch === "B") {
        if (!Array.isArray(event?.system)) {
          const msg = "Branch B SKIPPED: no system array to mutate"
          console.log("[vcc-probe]", msg)
          record(branch, `${msg}; keys=${keys.join(",")}`)
          return
        }
        event.system.push({ type: "text", text: `vcc-probe control ${MARKER}` })
        const msg = "Branch B control: system mutated only"
          + ` (${sysCount}->${event.system.length} parts),`
          + " messages intact, result unset"
        console.log("[vcc-probe]", msg)
        record(branch, `${msg}; keys=${keys.join(",")}`)
        return
      }

      const firstID = event?.messages?.[0]?.id
      if (typeof firstID !== "string" || firstID === "") {
        const msg = "Branch A SKIPPED: no message id for keepID"
        console.log("[vcc-probe]", msg)
        record(branch, `${msg}; keys=${keys.join(",")}`)
        return
      }
      event.result = { summary: MARKER, metadata: { keepID: firstID } }
      const msg = "Branch A: result set (summary marker,"
        + ` keepID=${firstID}); host must skip model call`
      console.log("[vcc-probe]", msg)
      record(branch, `${msg}; keys=${keys.join(",")}`)
    })
  },
})
