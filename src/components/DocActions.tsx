import { useState } from 'react'
import { openDocument, revealDocument, type HandoffResult } from '../lib/docs'
import { c, mono } from '../theme'

export function Action({ label, onClick }: { label: string; onClick: () => void }) {
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

/**
 * Handing a document to the rest of the machine, from wherever it is listed.
 *
 * Shared by the conversation and the library because the guarantee has to be
 * the same in both: an index id goes to the shell, the shell decides whether
 * it resolves to a path, and a refusal is said out loud rather than swallowed.
 * Two lists that each rolled their own would be two places for that to drift.
 */
export function Handoff({ id }: { id: string }) {
  const [note, setNote] = useState<string | null>(null)

  // A handoff to the OS can simply not happen - the file moved, or this is a
  // browser tab with no shell behind it. Saying which is better than a button
  // that appears to do nothing.
  const hand = async (run: () => Promise<HandoffResult>, verb: string) => {
    const result = await run()
    if (result === 'ok') return
    setNote(result === 'unsupported' ? `${verb} NEEDS THE DESKTOP APP` : `COULD NOT ${verb}`)
    window.setTimeout(() => setNote(null), 2600)
  }

  return (
    <>
      <Action label="REVEAL" onClick={() => void hand(() => revealDocument(id), 'REVEAL')} />
      <Action label="OPEN" onClick={() => void hand(() => openDocument(id), 'OPEN')} />
      {note && (
        <span style={{ color: c.warm, fontFamily: mono, fontSize: 9.5, letterSpacing: 2 }}>
          {note}
        </span>
      )}
    </>
  )
}
