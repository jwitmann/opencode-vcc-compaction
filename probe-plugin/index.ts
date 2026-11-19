import { Plugin } from "@opencode/plugin"

// Branch A/B probe — see ../PROBE.md. Fill hook body in next session.
export default Plugin.define({
  id: "vcc-probe",
  async setup(ctx) {
    await ctx.session.hook("compaction", (event: any) => {
      // log shape, then Branch A: event.result = "<deterministic marker 12345>"
      console.log("[vcc-probe] compaction keys:", Object.keys(event));
    });
  },
});
