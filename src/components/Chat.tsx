import { useState, type RefObject } from 'react'
import { Action, Handoff } from './DocActions'
import { c, mono, sans } from '../theme'
import type { FoundDoc } from '../lib/claude'
import type { FoundInTurn, Message } from '../types'
import { Glyph } from './Glyph'
import { Markdown } from './Markdown'

function Turn({
  m,
  streaming,
  showActions,
  copied,
  onCopy,
  onRegenerate,
  onConnect,
  onView,
  onAttach,
  attached,
}: {
  m: Message
  streaming: boolean
  showActions: boolean
  copied: boolean
  onCopy: () => void
  onRegenerate: () => void
  onConnect: () => void
  onView: (id: string) => void
  onAttach: (id: string) => void
  attached: Set<string>
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

      {m.found && m.found.length > 0 && (
        <Found found={m.found} onView={onView} onAttach={onAttach} attached={attached} />
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
  onView,
  onAttach,
  attached,
}: {
  messages: Message[]
  thinking: boolean
  thinkLabel: string
  streamingId: string | null
  convoRef: RefObject<HTMLDivElement | null>
  onRegenerate: () => void
  onConnect: () => void
  onView: (id: string) => void
  onAttach: (id: string) => void
  attached: Set<string>
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
              onView={onView}
              onAttach={onAttach}
              attached={attached}
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


/**
 * The documents Ø turned up while answering.
 *
 * Shown as a list of files rather than folded into the prose, because the
 * document is the thing the user wanted - not a sentence about it. Nothing here
 * has been read: these are names, and what to do with one is the reader's
 * decision.
 */
function Found({
  found,
  onView,
  onAttach,
  attached,
}: {
  found: FoundInTurn[]
  onView: (id: string) => void
  onAttach: (id: string) => void
  attached: Set<string>
}) {
  // The same document can surface in two searches within one turn; showing it
  // twice would suggest there are two of it.
  const seen = new Set<string>()
  const rows = []
  for (const f of found) {
    for (const r of f.results) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      rows.push(r)
    }
  }
  if (rows.length === 0) {
    return (
      <div
        style={{
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: 2,
          color: c.fainter,
          marginTop: 6,
        }}
      >
        NOTHING MATCHED — {found.map((f) => f.query.toUpperCase()).join(' · ')}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
      <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: 2, color: c.fainter }}>
        FOUND IN YOUR DOCUMENTS
      </div>
      {rows.map((r) => (
        <FoundRow
          key={r.id}
          r={r}
          onView={() => onView(r.id)}
          onAttach={() => onAttach(r.id)}
          attached={attached.has(r.id)}
        />
      ))}
    </div>
  )
}


/**
 * A found document, and what can be done with it.
 *
 * The four actions are deliberately different in kind, and the row says so by
 * ordering them from least to most consequential. VIEW and REVEAL stay on this
 * machine. OPEN hands the file to another program. ATTACH is the only one that
 * can lead to text leaving: it stages the document, and the approval sheet on
 * the next send still decides what actually goes.
 */
function FoundRow({
  r,
  onView,
  onAttach,
  attached,
}: {
  r: FoundDoc
  onView: () => void
  onAttach: () => void
  attached: boolean
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          fontFamily: mono,
          fontSize: 11.5,
          color: c.faint,
        }}
      >
        <span style={{ color: c.dim, fontSize: 9.5, letterSpacing: 1, minWidth: 34 }}>
          {r.ext.replace('.', '').toUpperCase()}
        </span>
        <span
          style={{
            color: c.code,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {r.name}
        </span>
        <span style={{ color: c.fainter, fontSize: 9.5, letterSpacing: 1, marginLeft: 'auto' }}>
          {r.modified}
          {r.copies ? ` · ${r.copies} COPIES` : ''}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 14,
          paddingLeft: 44,
          height: 14,
          opacity: hover ? 1 : 0,
          transition: 'opacity 160ms ease',
        }}
      >
        <Action label="VIEW" onClick={onView} />
        <Handoff id={r.id} />
        <Action label={attached ? 'ATTACHED' : 'ATTACH'} onClick={onAttach} />
      </div>
    </div>
  )
}
