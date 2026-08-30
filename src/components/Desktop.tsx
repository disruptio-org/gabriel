import { useState } from 'react'
import { c, mono } from '../theme'
import { Glyph } from './Glyph'

/**
 * The launcher. One target, no chrome, no menu - the whole interaction is
 * "click to summon".
 */
export function Desktop({ onLaunch }: { onLaunch: () => void }) {
  const [hover, setHover] = useState(false)

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
      }}
    >
      <button
        type="button"
        onClick={onLaunch}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Personal Intelligence"
        aria-label="Summon Personal Intelligence"
        style={{
          width: 96,
          height: 96,
          padding: 0,
          borderRadius: 22,
          background: 'linear-gradient(160deg, #0B0F0C, #060907)',
          border: `1px solid ${hover ? c.dim : c.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'box-shadow 260ms ease, border-color 260ms ease',
          boxShadow: hover
            ? '0 0 60px rgba(105,255,148,0.16), inset 0 1px 0 rgba(232,238,233,0.06)'
            : '0 0 40px rgba(105,255,148,0.07), inset 0 1px 0 rgba(232,238,233,0.04)',
        }}
      >
        <Glyph size={44} mode="icon" />
      </button>

      <div style={{ color: c.muted, fontSize: 12, letterSpacing: 1, fontFamily: mono }}>
        Personal Intelligence
      </div>

      <div
        style={{
          color: c.fainter,
          fontSize: 11,
          letterSpacing: 2,
          textTransform: 'uppercase',
          marginTop: 26,
          fontFamily: mono,
          animation: 'oPulse 3.4s ease-in-out infinite',
        }}
      >
        click to summon
      </div>
    </div>
  )
}
