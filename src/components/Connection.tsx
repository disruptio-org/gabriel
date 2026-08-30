import { useEffect, useRef, useState } from 'react'
import {
  clearKey,
  saveKey,
  PRIMARY,
  PROVIDER_IDS,
  PROVIDER_UI,
  type ProviderId,
  type ProviderStatus,
} from '../lib/claude'
import { c, ease, mono, sans } from '../theme'

/**
 * Credential entry (§16). The key is typed, handed straight to the local
 * service for verification, and never held in component state afterwards -
 * once stored, only its last four characters are ever shown again.
 *
 * Two providers share one dialog because they share one discipline. They are
 * tabs rather than two stacked forms: the copy, placeholder and stored hint all
 * differ per provider, so a second form would duplicate everything except the
 * rule that matters.
 *
 * They are not equal, though. Claude is what the app is; OpenAI is what one
 * feature needs. Only the first can leave the app unusable, and the dialog says
 * so rather than presenting two identically weighted choices.
 */
export function Connection({
  providers,
  initial = PRIMARY,
  onDone,
  onClose,
}: {
  providers: Record<ProviderId, ProviderStatus> | null
  /** Which tab opens first - voice sends the user straight to OpenAI. */
  initial?: ProviderId
  onDone: () => void
  onClose: () => void
}) {
  const [provider, setProvider] = useState<ProviderId>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const ui = PROVIDER_UI[provider]
  const hint = providers?.[provider]?.hint ?? null

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

  // Switching tabs must not carry one provider's error, or its typed key, over
  // to the other.
  const select = (next: ProviderId) => {
    if (next === provider) return
    if (inputRef.current) inputRef.current.value = ''
    setError(null)
    setNote(null)
    setProvider(next)
    inputRef.current?.focus()
  }

  const submit = async () => {
    const el = inputRef.current
    if (!el || busy) return
    const key = el.value.trim()
    if (!key) return

    // Caught here so a mistyped key costs nothing; the service checks again.
    if (!key.startsWith(ui.prefix)) {
      setError(ui.malformed)
      el.select()
      return
    }

    setBusy(true)
    setError(null)
    setNote(null)
    const res = await saveKey(provider, key)
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
    await clearKey(provider)
    setBusy(false)
    setNote(null)
    onDone()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connections"
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
        <div role="tablist" aria-label="Provider" style={{ display: 'flex', gap: 18 }}>
          {PROVIDER_IDS.map((id) => (
            <Tab
              key={id}
              label={PROVIDER_UI[id].tab}
              connected={providers?.[id]?.connected ?? false}
              selected={id === provider}
              onSelect={() => select(id)}
            />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: c.text, fontFamily: sans, fontSize: 14.5, lineHeight: 1.6 }}>
            {hint ? 'A key is stored. Enter a new one to replace it.' : ui.purpose}
          </span>
        </div>

        {hint && (
          <div style={{ color: c.faint, fontFamily: mono, fontSize: 11, letterSpacing: 1 }}>
            STORED: {hint}
          </div>
        )}

        <input
          ref={inputRef}
          // Remounted per provider, so a key typed under one tab can never be
          // submitted under the other.
          key={provider}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={ui.placeholder}
          aria-label={`${ui.tab} API key`}
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
        {note && <div style={{ color: c.muted, fontFamily: sans, fontSize: 13 }}>{note}</div>}

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
            {/* Precise on purpose: the *key* stays here. What a provider does
                with what the app sends it is a separate promise, made where
                that sending happens. */}
            KEY NEVER LEAVES THIS MACHINE
          </span>
        </div>
      </div>
    </div>
  )
}

function Tab({
  label,
  connected,
  selected,
  onSelect,
}: {
  label: string
  connected: boolean
  selected: boolean
  onSelect: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'none',
        border: 'none',
        borderBottom: `1px solid ${selected ? c.dim : 'transparent'}`,
        padding: '0 0 6px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontFamily: mono,
        fontSize: 10,
        letterSpacing: 3,
        color: selected ? c.muted : hover ? c.faint : c.fainter,
        transition: 'color 160ms ease',
      }}
    >
      {label}
      {/* Which credentials exist, readable without opening each tab. */}
      <span aria-hidden style={{ color: connected ? c.accent : c.fainter, fontSize: 8 }}>
        {connected ? '●' : '○'}
      </span>
    </button>
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
