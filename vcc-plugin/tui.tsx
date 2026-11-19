/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui"
import { isReplyPayload, MAX_TOAST_TEXT, replyEventType } from "./events.mjs"

// opencode-vcc-compaction TUI companion: quiet visible output for the
// server /vcc-* commands. The server emits
// `rpc.opencode-vcc-compaction.replied` and returns void (no wake, no
// chatter); this listener toasts/dialogs the reply. No keymap commands:
// slash lookup has no session context, and none is needed — the event
// carries its session. (ODF tui.tsx pattern: dialog.alert large +
// centered for long content.)

const replyType = replyEventType()

export default Plugin.define({
  id: "opencode-vcc-compaction",
  setup(ctx) {
    ctx.data.listen((event) => {
      try {
        const details = (event as { details?: unknown }).details as
          | { type?: unknown; data?: unknown }
          | undefined
        if (details?.type !== replyType) return
        const payload = (details as { data?: unknown }).data
        // Runtime shape already validated; the guard lives in untyped
        // .mjs (no node_modules for real types), so narrow by cast.
        if (!isReplyPayload(payload)) return
        const reply = payload as { sessionID: string; command: string; text: string }
        const title = `vcc ${reply.command}`
        if (reply.text.length < MAX_TOAST_TEXT) {
          // Host-native attribution: the toast ties itself to the
          // reply's session (session title + open offer when its family
          // is not open). Dialogs have no such option (see below).
          void ctx.ui.toast.show({ title, message: reply.text, variant: "info", sessionID: reply.sessionID })
          return
        }
        // ODF dialog pattern: alert, then presentation, then drop the handle.
        // Broadcast by design: DialogAlertOptions carries no sessionID, so a
        // long reply dialogs in whatever session is viewed. Suppression was
        // considered (via ctx.ui.router.current()) and rejected — a user who
        // fires /vcc-recall and switches sessions mid-flight should still
        // see the answer, and the title names the command.
        const shown = ctx.ui.dialog.alert({ title, message: reply.text })
        ctx.ui.dialog.set({ size: "large", centered: true })
        void shown
      } catch (error) {
        console.warn("[opencode-vcc-compaction] reply render failed:", error)
      }
    })
  },
})
