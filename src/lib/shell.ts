/**
 * The desktop shell bridge, exposed by electron/preload.cjs.
 *
 * Everything here is optional: in the browser (npm run dev) `window.pi` is
 * undefined and `shell` is null, so the app falls back to drawing its own
 * window inside the page. Under Electron the same controls drive the real
 * OS window.
 */
export interface Shell {
  minimize: () => Promise<void>
  close: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  isMaximized: () => Promise<boolean>
  setPhase: (phase: 'desktop' | 'chat') => Promise<void>
  onMaximizeChange: (cb: (maxed: boolean) => void) => () => void
}

declare global {
  interface Window {
    pi?: Shell
  }
}

export const shell: Shell | null = typeof window !== 'undefined' ? (window.pi ?? null) : null

/** True when running as the Windows desktop app rather than in a browser tab. */
export const isDesktopApp = shell !== null

declare module 'react' {
  interface CSSProperties {
    /** Electron frameless-window drag regions; ignored by browsers. */
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
