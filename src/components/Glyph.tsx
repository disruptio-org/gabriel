import { c } from '../theme'

/** Living-glyph states from requirements §4.2. */
export type GlyphMode = 'dormant' | 'ready' | 'thinking' | 'icon'

/**
 * Ø - a ring with a diagonal incision. No face, no sparkle, no brain. The
 * silhouette has to survive at 16px, so nothing but stroke carries the form.
 */
export function Glyph({ size, mode }: { size: number; mode: GlyphMode }) {
  const r = size * 0.3
  const mid = size / 2
  const ext = r * 1.42
  const stroke = Math.max(1.5, size * 0.045)

  const dormant = mode === 'dormant' || mode === 'icon'

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      style={{
        filter: dormant
          ? 'drop-shadow(0 0 4px rgba(105,255,148,0.25))'
          : 'drop-shadow(0 0 8px rgba(105,255,148,0.45))',
        opacity: dormant ? 0.55 : 1,
        animation: mode === 'ready' ? 'oPulse 4s ease-in-out infinite' : 'none',
        overflow: 'visible',
      }}
    >
      <circle cx={mid} cy={mid} r={r} fill="none" stroke={c.accent} strokeWidth={stroke} />
      <g
        style={{
          transformOrigin: `${mid}px ${mid}px`,
          animation: mode === 'thinking' ? 'oSpin 2.6s linear infinite' : 'none',
        }}
      >
        <line
          x1={mid - ext * 0.707}
          y1={mid + ext * 0.707}
          x2={mid + ext * 0.707}
          y2={mid - ext * 0.707}
          stroke={c.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}
