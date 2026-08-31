import { useEffect, useState } from 'react'
import type { Attachment, DocHit } from '../lib/docs'
import { shortPath } from '../lib/docs'
import { c, ease, mono, sans } from '../theme'

/**
 * The consent gate. These passages came off this machine's index; nothing here
 * has left it. This sheet shows the exact text that would be sent, per file,
 * and sends only what is still ticked when the user confirms.
 *
 * Deliberately shows the passage in full rather than a summary of it: the
 * point of approving is seeing what you are approving.
 */
export function Approval({
  question,
  hits,
  onSend,
  onCancel,
}: {
  question: string
  hits: DocHit[]
  onSend: (attachments: Attachment[]) => void
  onCancel: () => void
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(hits.map((h) => h.id)))
  const [open, setOpen] = useState<string | null>(hits[0]?.id ?? null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
      // Enter sends what is ticked - the same key that opened this sheet.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        send()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const send = () =>
    onSend(
      hits
        .filter((h) => chosen.has(h.id) && h.passage)
        .map((h) => ({ id: h.id, offset: h.passage!.offset, length: h.passage!.text.length })),
    )

  const count = chosen.size

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Approve document context"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(3,4,4,0.86)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 25,
        animation: `oFade 200ms ${ease}`,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          width: 'min(760px, calc(100% - 48px))',
          maxHeight: 'calc(100% - 64px)',
          background: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ padding: '22px 26px 14px', borderBottom: `1px solid ${c.border}` }}>
          <div style={{ color: c.muted, fontFamily: mono, fontSize: 10, letterSpacing: 3 }}>
            SEND THESE PASSAGES TO CLAUDE?
          </div>
          <div
            style={{
              color: c.text,
              fontFamily: sans,
              fontSize: 14,
              lineHeight: 1.6,
              marginTop: 8,
            }}
          >
            You attached {hits.length} {hits.length === 1 ? 'file' : 'files'}. Below is the part
            of each that would go with “
            {question.length > 70 ? question.slice(0, 70) + '…' : question}” — only what you leave
            ticked is sent, never the whole file.
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '6px 0' }}>
          {hits.map((h) => {
            const on = chosen.has(h.id)
            const expanded = open === h.id
            return (
              <div key={h.id} style={{ padding: '10px 26px', opacity: on ? 1 : 0.45 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => toggle(h.id)}
                    aria-pressed={on}
                    aria-label={`Include ${h.name}`}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: on ? c.accent : c.faint,
                      fontFamily: mono,
                      fontSize: 12,
                    }}
                  >
                    {on ? '[x]' : '[ ]'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : h.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      flex: 1,
                    }}
                  >
                    <div style={{ color: c.text, fontFamily: mono, fontSize: 12 }}>{h.name}</div>
                    <div style={{ color: c.fainter, fontFamily: mono, fontSize: 9.5, marginTop: 3 }}>
                      {shortPath(h.path)}
                    </div>
                  </button>
                  <span style={{ color: c.fainter, fontFamily: mono, fontSize: 9.5 }}>
                    {h.passage ? `${h.passage.text.length} CHARS` : 'NO PASSAGE'}
                  </span>
                </div>

                {expanded && h.passage && (
                  <pre
                    style={{
                      margin: '10px 0 0 26px',
                      padding: '10px 12px',
                      background: c.codeBg,
                      border: `1px solid ${c.border}`,
                      borderRadius: 6,
                      color: c.dim,
                      fontFamily: mono,
                      fontSize: 11,
                      lineHeight: 1.65,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 220,
                      overflowY: 'auto',
                    }}
                  >
                    {h.passage.text}
                  </pre>
                )}
              </div>
            )
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '14px 26px 18px',
            borderTop: `1px solid ${c.border}`,
            flexWrap: 'wrap',
          }}
        >
          <Action label={count ? `SEND WITH ${count}` : 'SEND WITH NONE'} onClick={send} primary />
          <Action label="SEND WITHOUT DOCUMENTS" onClick={() => onSend([])} />
          <Action label="CANCEL" onClick={onCancel} />
          <span
            style={{
              marginLeft: 'auto',
              color: c.fainter,
              fontFamily: mono,
              fontSize: 9.5,
              letterSpacing: 1.5,
            }}
          >
            NOTHING SENT UNTIL YOU CHOOSE
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
