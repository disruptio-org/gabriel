// Design tokens. Palette from requirements §5.3; every value also appears in
// the source artboard, so keep the two in step.
export const c = {
  void: '#050706', // the canvas
  surface: '#0B0F0C', // elevated surface
  text: '#E8EEE9', // primary
  muted: '#89958C', // secondary
  accent: '#69FF94', // phosphor - energy, not decoration
  dim: '#275E38',
  border: '#16211a',
  borderSoft: '#1a241d',
  faint: '#4d5a51',
  fainter: '#3d4a41',
  ghost: '#2a352e',
  code: '#c9d6cc',
  codeBg: '#070a08',
  inlineCode: '#a4ffc0',
  // Restrained warm signal rather than a saturated warning red (§5.3).
  warm: '#C8845A',
} as const

export const mono = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const sans = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"

export const ease = 'cubic-bezier(0.22, 1, 0.36, 1)'
