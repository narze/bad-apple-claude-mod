export type Mode = 'off' | 'pane' | 'band'

declare module 'claude-code' {
  interface PluginState {
    'bad-apple': { mode: Mode; isPaused: boolean }
  }
}
