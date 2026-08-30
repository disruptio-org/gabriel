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
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>
  busy: boolean
  status: string
  connected: boolean
  onSend: (text: string) => void
  onStop: () => void
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
        <span
          style={{
            color: connected ? c.ghost : c.warm,
            fontSize: 9.5,
            letterSpacing: 1.5,
            fontFamily: mono,
          }}
        >
          {connected
            ? 'ENTER SEND · SHIFT+ENTER NEWLINE · ESC STOP'
            : 'Ø NEEDS A CLAUDE CONNECTION — SET ANTHROPIC_API_KEY IN .env'}
        </span>
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
