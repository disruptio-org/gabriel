import type { AnimationMode } from './types'

// The three knobs the source artboard exposes as props, persisted locally so
// window/appearance preferences survive a restart (FR-16).
export interface Config {
  userName: string
  model: string
  animationMode: AnimationMode
  /**
   * Whether the user has been told, once, that voice sends a recording to
   * OpenAI - and agreed to it. Stored rather than asked every time, because a
   * prompt shown on every use stops being read.
   */
  voiceConsent: boolean
}

const KEY = 'pi.config'

const DEFAULTS: Config = {
  userName: 'Iago',
  // Opus 5 is the most capable model available; this product's entire promise
  // is the quality of the thinking, so it is the default. Overridable below.
  model: 'claude-opus-5',
  animationMode: 'full',
  // Nobody has agreed to anything yet.
  voiceConsent: false,
}

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Config>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function saveConfig(next: Config): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable - preferences simply do not persist */
  }
}

/** OS-level reduced-motion always wins over the stored preference (§18). */
export function effectiveMotion(mode: AnimationMode): AnimationMode {
  const prefersReduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReduced && mode === 'full') return 'reduced'
  return mode
}
