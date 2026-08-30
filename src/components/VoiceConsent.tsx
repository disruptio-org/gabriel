import { useEffect, useState } from 'react'
import { c, ease, mono, sans } from '../theme'

/**
 * Shown once, before the microphone is opened for the first time.
 *
 * This app's promise is that nothing leaves the machine unless the user
 * approved it, and the document library keeps that promise per send. Voice
 * cannot: a recording has to reach OpenAI to become text. So the promise is not
 * quietly weakened - it is restated accurately, once, at the moment it changes,
 * and the answer is remembered rather than asked again. A prompt shown every
 * time stops being read, which is worse than no prompt at all.
 */
export function VoiceConsent({
  onAccept,
  onCancel,
}: {
  onAccept: () => void
  onCancel: () => void
}) {
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const Action = ({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(label)}
      onMouseLeave={() => setHover(null)}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontFamily: mono,
        fontSize: 10,
        letterSpacing: 2,
        color: primary
          ? hover === label
            ? c.accent
            : c.dim
          : hover === label
            ? c.text
            : c.faint,
        transition: 'color 160ms ease',
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice and your recordings"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(3,4,4,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
        animation: `oFade 240ms ${ease}`,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          width: 'min(520px, calc(100% - 64px))',
          background: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 10,
          padding: '26px 28px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        <span style={{ color: c.muted, fontFamily: mono, fontSize: 10, letterSpacing: 3 }}>
          BEFORE Ø LISTENS
        </span>

        <div
          style={{
            color: c.text,
            fontFamily: sans,
            fontSize: 14.5,
            lineHeight: 1.65,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <span>
            Speaking sends your recording to OpenAI, which turns it into text. That is the one
            thing on this machine that leaves it without you approving each time.
          </span>
          <span style={{ color: c.muted }}>
            The recording is held only while it is being transcribed, and is never saved, replayed
            or written to disk. Your documents are unaffected — they are still only ever sent as
            passages you tick.
          </span>
        </div>

        <div
          style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 2, flexWrap: 'wrap' }}
        >
          <Action label="ENABLE VOICE" onClick={onAccept} primary />
          <Action label="NOT NOW" onClick={onCancel} />
          <span
            style={{
              marginLeft: 'auto',
              color: c.fainter,
              fontFamily: mono,
              fontSize: 9.5,
              letterSpacing: 1.5,
            }}
          >
            ASKED ONCE
          </span>
        </div>
      </div>
    </div>
  )
}
