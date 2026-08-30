import { useState, type KeyboardEvent, type RefObject } from 'react'
import { c, mono } from '../theme'

const MAX_HEIGHT = 160

export function Composer({
  inputRef,
  busy,
  status,
  connected,
  onSend,
  onStop,
  onConnect,
  docs,
  onToggleDocs,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>
  busy: boolean
  status: string
  connected: boolean
  onSend: (text: string) => void
  onStop: () => void
  onConnect: () => void
  /** Whether a send searches the local library first. Consent is still per send. */
  docs: boolean
  onToggleDocs: () => void
}) {
  const [focused, setFocused] = useState(false)
  const [hoverSend, setHoverSend] = useState(false)

  const submit = () => {
    const el = inputRef.current
    if (!el) return
    const text = el.value.trim()
    if (!text || busy) return
    el.value = ''
    el.style.height = 'auto'
    onSend(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div style={{ flex: '0 0 auto', padding: '14px 40px 22px' }}>
      <div
        style={{
          maxWidth: 680,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          border: `1px solid ${focused ? c.dim : c.border}`,
          background: c.surface,
          borderRadius: 8,
          padding: '11px 12px 11px 16px',
          transition: 'border-color 200ms',
        }}
      >
        <span style={{ color: c.dim, fontSize: 13, lineHeight: '22px', flex: '0 0 auto' }}>›</span>

        <textarea
          id="prompt"
          ref={inputRef}
          rows={1}
          placeholder="What are we thinking about?"
          aria-label="What are we thinking about?"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: c.text,
            fontFamily: mono,
            fontSize: 13.5,
            lineHeight: '22px',
            maxHeight: MAX_HEIGHT,
            padding: 0,
          }}
        />

        <button
          type="button"
          onClick={() => (busy ? onStop() : submit())}
          onMouseEnter={() => setHoverSend(true)}
          onMouseLeave={() => setHoverSend(false)}
          title={busy ? 'Stop (Esc)' : 'Send (Enter)'}
          aria-label={busy ? 'Stop generating' : 'Send'}
          style={{
            flex: '0 0 auto',
            width: 26,
            height: 26,
            padding: 0,
            borderRadius: 5,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: hoverSend ? c.accent : c.faint,
            background: hoverSend ? 'rgba(105,255,148,0.07)' : 'transparent',
            fontSize: 12,
            fontFamily: mono,
          }}
        >
          {busy ? '■' : '↵'}
        </button>
      </div>

      <div
        style={{
          maxWidth: 680,
          margin: '8px auto 0',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        {connected ? (
          <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
            <span style={{ color: c.ghost, fontSize: 9.5, letterSpacing: 1.5, fontFamily: mono }}>
              ENTER SEND · SHIFT+ENTER NEWLINE · ESC STOP
            </span>
            {/* Turning this off skips the local search entirely - no passages
                are found, so none can be offered. */}
            <button
              type="button"
              onClick={onToggleDocs}
              title={
                docs
                  ? 'Ø checks your local library and asks before sending anything from it (Ctrl+D to browse)'
                  : 'Ø ignores your documents entirely'
              }
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: mono,
                fontSize: 9.5,
                letterSpacing: 1.5,
                color: docs ? c.dim : c.ghost,
              }}
            >
              {docs ? 'DOCS ON' : 'DOCS OFF'}
            </button>
          </span>
        ) : (
          // The fix is one click away rather than a line of documentation.
          <button
            type="button"
            onClick={onConnect}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: c.warm,
              fontSize: 9.5,
              letterSpacing: 1.5,
              fontFamily: mono,
              textAlign: 'left',
            }}
          >
            Ø NEEDS A CLAUDE CONNECTION — CONNECT
          </button>
        )}
        <span
          style={{
            color: c.ghost,
            fontSize: 9.5,
            letterSpacing: 1.5,
            fontFamily: mono,
            flex: '0 0 auto',
          }}
        >
          {status}
        </span>
      </div>
    </div>
  )
}
