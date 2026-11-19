// Local-only typecheck shim (never shipped: not in `files`).
// `@opencode/theme` ships inside the host TUI runtime; it is absent from
// every local node_modules tree, and this companion never touches theme,
// so an `any` alias is sufficient to satisfy the plugin context import.
declare module "@opencode/theme/tui" {
  const ResolvedTheme: any
  export type { ResolvedTheme }
}
