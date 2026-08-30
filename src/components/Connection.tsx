import { useEffect, useRef, useState } from 'react'
import { clearKey, saveKey } from '../lib/claude'
import { c, ease, mono, sans } from '../theme'

/**
 * Credential entry (§16). The key is typed, handed straight to the local
 * service for verification, and never held in component state afterwards -
 * once stored, only its last four characters are ever shown again.
 */
export function Connection({
  hint,
  onDone,
  onClose,
}: {
  hint: string | null
  onDone: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const submit = async () => {
    const el = inputRef.current
    if (!el || busy) return
    const key = el.value.trim()
    if (!key) return

    setBusy(true)
    setError(null)
    setNote(null)
    const res = await saveKey(key)
    // Clear the field either way: a rejected key should not sit on screen.
    el.value = ''
    setBusy(false)

    if (!res.ok) {
      setError(res.error ?? 'That key could not be stored.')
      el.focus()
      return
    }
    if (res.warning) setNote(res.warning)
    onDone()
  }

  const disconnect = async () => {
    setBusy(true)
    await clearKey()
    setBusy(false)
    setNote(null)
    onDone()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Claude connection"
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
        if (e.target === e.currentTarget) onClose()
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: c.muted, fontFamily: mono, fontSize: 10, letterSpacing: 3 }}>
            CLAUDE CONNECTION
          </span>
          <span style={{ color: c.text, fontFamily: sans, fontSize: 14.5, lineHeight: 1.6 }}>
            {hint
              ? 'A key is stored. Enter a new one to replace it.'
              : 'Ø needs a Claude API key to think. It is verified, then stored on this machine only.'}
          </span>
        </div>

        {hint && (
          <div style={{ color: c.faint, fontFamily: mono, fontSize: 11, letterSpacing: 1 }}>
            STORED: {hint}
          </div>
        )}

        <input
          ref={inputRef}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-..."
          aria-label="Claude API key"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          style={{
            background: c.codeBg,
            border: `1px solid ${c.border}`,
            borderRadius: 6,
            padding: '11px 13px',
            color: c.text,
            fontFamily: mono,
            fontSize: 13,
            outline: 'none',
          }}
        />

        {error && (
          <div style={{ color: c.warm, fontFamily: sans, fontSize: 13 }} role="alert">
            {error}
          </div>
        )}
        {note && (
          <div style={{ color: c.muted, fontFamily: sans, fontSize: 13 }}>{note}</div>
        )}

        <div
          style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 2, flexWrap: 'wrap' }}
        >
          <Action label={busy ? 'CHECKING' : 'CONNECT'} onClick={() => void submit()} primary />
          <Action label="CANCEL" onClick={onClose} />
          {hint && <Action label="DISCONNECT" onClick={() => void disconnect()} />}
          <span
            style={{
              marginLeft: 'auto',
              color: c.fainter,
              fontFamily: mono,
              fontSize: 9.5,
              letterSpacing: 1.5,
            }}
          >
            NEVER LEAVES THIS MACHINE
          </span>
        </div>
      </div>
    </div>
  )
}

function Action({
  label,
  onClick,
  primary,
}: {
  label: string
  onClick: () => void
  primary?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontFamily: mono,
        fontSize: 10,
        letterSpacing: 2,
        color: primary ? (hover ? c.accent : c.dim) : hover ? c.text : c.faint,
        transition: 'color 160ms ease',
      }}
    >
      {label}
    </button>
  )
}
