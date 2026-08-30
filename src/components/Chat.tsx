import { useState, type RefObject } from 'react'
import { c, mono, sans } from '../theme'
import type { Message } from '../types'
import { Glyph } from './Glyph'
import { Markdown } from './Markdown'

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        color: hover ? c.accent : c.faint,
        fontSize: 10,
        letterSpacing: 2,
        cursor: 'pointer',
        fontFamily: mono,
      }}
    >
      {label}
    </span>
  )
}

function Turn({
  m,
  streaming,
  showActions,
  copied,
  onCopy,
  onRegenerate,
  onConnect,
}: {
  m: Message
  streaming: boolean
  showActions: boolean
  copied: boolean
  onCopy: () => void
  onRegenerate: () => void
  onConnect: () => void
}) {
  const isUser = m.role === 'user'
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: 3,
          fontWeight: 600,
          color: isUser ? c.faint : c.accent,
          fontFamily: mono,
        }}
      >
        {isUser ? 'YOU' : 'Ø'}
      </div>

      {isUser ? (
        <div
          style={{
            fontFamily: mono,
            fontSize: 13.5,
            lineHeight: 1.6,
            color: c.code,
            whiteSpace: 'pre-wrap',
          }}
        >
          {m.content}
        </div>
      ) : m.error ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontFamily: sans, fontSize: 14.5, color: c.muted }}>{m.content}</div>
          {m.detail && (
            <details style={{ fontFamily: mono, fontSize: 10, color: c.fainter, letterSpacing: 1 }}>
              <summary style={{ cursor: 'pointer', letterSpacing: 2 }}>DETAIL</summary>
              <div style={{ marginTop: 6, color: c.faint, letterSpacing: 0 }}>{m.detail}</div>
            </details>
          )}
        </div>
      ) : (
        <Markdown text={m.content} streaming={streaming} />
      )}

      {m.stopped && (
        <div
          style={{
            color: c.faint,
            fontSize: 10,
            letterSpacing: 2,
            marginTop: 8,
            fontFamily: mono,
          }}
        >
          GENERATION STOPPED.
        </div>
      )}

      {showActions && !m.error && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 2,
            opacity: hover ? 1 : 0.5,
            transition: 'opacity 160ms ease',
          }}
        >
          <Action label={copied ? 'COPIED' : 'COPY'} onClick={onCopy} />
          <Action label="REGENERATE" onClick={onRegenerate} />
        </div>
      )}

      {m.error && showActions && (
        <div style={{ display: 'flex', gap: 16, marginTop: 2, opacity: 0.7 }}>
          {/* A missing or rejected key is fixable here, not just retryable. */}
          {(m.error === 'no_key' || m.error === 'auth') && (
            <Action label="CONNECT" onClick={onConnect} />
          )}
          <Action label="RETRY" onClick={onRegenerate} />
        </div>
      )}
    </div>
  )
}

export function Chat({
  messages,
  thinking,
  thinkLabel,
  streamingId,
  convoRef,
  onRegenerate,
  onConnect,
}: {
  messages: Message[]
  thinking: boolean
  thinkLabel: string
  streamingId: string | null
  convoRef: RefObject<HTMLDivElement | null>
  onRegenerate: () => void
  onConnect: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)

  if (messages.length === 0 && !thinking) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 26,
        }}
      >
        <Glyph size={88} mode="ready" />
        <div style={{ color: c.muted, fontSize: 13, letterSpacing: 0.5, fontFamily: mono }}>
          What are we thinking about?
        </div>
      </div>
    )
  }

  const last = messages[messages.length - 1]

  return (
    <div id="convo" ref={convoRef} style={{ flex: 1, overflowY: 'auto', padding: '34px 40px 20px' }}>
      <div
        style={{
          maxWidth: 680,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 34,
        }}
      >
        {messages.map((m) => {
          const isLast = m.id === last?.id
          const streaming = m.id === streamingId
          return (
            <Turn
              key={m.id}
              m={m}
              streaming={streaming}
              showActions={isLast && m.role === 'assistant' && !streaming && !thinking}
              copied={copied === m.id}
              onCopy={() => {
                void navigator.clipboard.writeText(m.content)
                setCopied(m.id)
                window.setTimeout(() => setCopied(null), 1400)
              }}
              onRegenerate={onRegenerate}
              onConnect={onConnect}
            />
          )
        })}

        {thinking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Glyph size={22} mode="thinking" />
            <span
              style={{
                color: c.faint,
                fontSize: 11,
                letterSpacing: 1,
                fontFamily: mono,
                animation: 'oFlick 2s ease-in-out infinite',
              }}
            >
              {thinkLabel}
            </span>
          </div>
        )}

        <div style={{ height: 8 }} />
      </div>
    </div>
  )
}
