import { useEffect } from 'react'
import type { DocText } from '../lib/docs'
import { c, ease, mono } from '../theme'

/**
 * One document, read inside the app.
 *
 * The point of reading here rather than in Word or Acrobat is that nothing
 * happens outside this window: the text came from the local index over
 * loopback, and looking at it sends nothing anywhere. It is plain extracted
 * text, not the document's layout - enough to know whether this is the file
 * you meant.
 */
export function DocReader({ doc, onClose }: { doc: DocText; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={doc.name}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(3,4,4,0.86)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 24,
        animation: `oFade 200ms ${ease}`,
      }}
    >
      <div
        style={{
          width: 'min(760px, 88%)',
          maxHeight: '82%',
          display: 'flex',
          flexDirection: 'column',
          background: c.surface,
          border: `1px solid ${c.border}`,
        }}
      >
        <div
          style={{
            padding: '14px 22px',
            borderBottom: `1px solid ${c.border}`,
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: c.text, fontFamily: mono, fontSize: 12.5 }}>{doc.name}</div>
            <div
              style={{
                color: c.fainter,
                fontFamily: mono,
                fontSize: 9.5,
                marginTop: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {doc.path}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: c.faint,
              cursor: 'pointer',
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: 2,
            }}
          >
            CLOSE
          </button>
        </div>

        <pre
          style={{
            margin: 0,
            padding: '18px 22px',
            overflowY: 'auto',
            color: c.dim,
            fontFamily: mono,
            fontSize: 11.5,
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {doc.text}
        </pre>

        {doc.truncated && (
          // Said out loud, because a reader who scrolls to the end of a
          // silently cut document believes they have seen all of it.
          <div
            style={{
              padding: '10px 22px',
              borderTop: `1px solid ${c.border}`,
              color: c.fainter,
              fontFamily: mono,
              fontSize: 9.5,
              letterSpacing: 2,
            }}
          >
            SHOWING THE FIRST PART ONLY — THIS DOCUMENT IS LONGER
          </div>
        )}
      </div>
    </div>
  )
}
