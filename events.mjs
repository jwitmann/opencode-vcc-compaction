// Event contract for the vcc TUI companion (dependency-free).
//
// The server cannot emit visible output without waking the agent, so
// /vcc-* replies travel as an RPC event the TUI toasts: the server
// emits `rpc.opencode-vcc-compaction.replied` with the reply payload
// and returns void with no prompt call (no wake, no chatter, no inbox
// row). The TUI filters `ctx.data.listen` by `replyEventType()` and
// renders it.
//
// Both `index.ts` (server, Rpc.define + emit) and `tui.tsx` (TUI,
// listen + dialog) import this module so the type string and payload
// shape have a single source of truth. No external imports so
// `selftest.mjs` runs it without node_modules.

export const VCC_RPC_ID = "opencode-vcc-compaction";

export const VCC_REPLY_EVENT = "replied";

export function replyEventType() {
  return `rpc.${VCC_RPC_ID}.${VCC_REPLY_EVENT}`;
}

// The bus carries the whole reply; cap pathological payloads (a huge
// recall range) so one event cannot flood it. Truncation is explicit.
export const MAX_REPLY_TEXT = 30000;

// Payload the server emits per command reply. `command` is the slash
// name without arguments ("/vcc-status"); `text` the rendered reply.
// Non-string text is coerced so a future caller passing unvalidated
// data gets a payload (which `isReplyPayload` still accepts) instead
// of an exception on `.length`.
export function buildReplyPayload(sessionID, command, text) {
  const body = typeof text === "string" ? text : String(text);
  return {
    sessionID,
    command,
    text:
      body.length > MAX_REPLY_TEXT
        ? `${body.slice(0, MAX_REPLY_TEXT)}\n\n[truncated: reply exceeds ${MAX_REPLY_TEXT} chars — narrow the selection and retry]`
        : body,
  };
}

// Short replies toast; longer ones need a large centered dialog.
export const MAX_TOAST_TEXT = 300;

export function isReplyPayload(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.sessionID === "string" &&
    typeof value.command === "string" &&
    typeof value.text === "string"
  );
}
