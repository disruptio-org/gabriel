import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addRoot,
  cancelIndex,
  docText,
  docsStatus,
  reindex,
  removeRoot,
  searchDocs,
  shortPath,
  type DocHit,
  type DocsStatus,
} from '../lib/docs'
import { Handoff } from './DocActions'
import { c, ease, mono, sans } from '../theme'

/**
 * The local library: what Ø can see on this machine, and nothing more.
 * Browsing and reading here are entirely local - a document's text reaches
 * Claude only through the approval sheet on send.
 */
export function Library({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<DocsStatus | null>(null)
  const [hits, setHits] = useState<DocHit[] | null>(null)
  const [reading, setReading] = useState<{ name: string; path: string; text: string } | null>(null)
  const [query, setQuery] = useState('')
  const [newRoot, setNewRoot] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => setStatus(await docsStatus()), [])

  useEffect(() => {
    void refresh()
    searchRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (reading) setReading(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, reading, refresh])

  // While a crawl is running the counters move; poll only then.
  useEffect(() => {
    if (!status?.building) return
    const t = setInterval(() => void refresh(), 700)
    return () => clearInterval(t)
  }, [status?.building, refresh])

  const runSearch = async (q: string) => {
    setQuery(q)
    setHits(q.trim().length > 1 ? await searchDocs(q, 12) : null)
  }

  const open = async (h: DocHit) => {
    const d = await docText(h.id, query)
    if (d) setReading({ name: d.name, path: d.path, text: d.text })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Local library"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(3,4,4,0.86)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 22,
        animation: `oFade 200ms ${ease}`,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 'min(820px, calc(100% - 48px))',
          height: 'calc(100% - 64px)',
          background: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${c.border}` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ color: c.muted, fontFamily: mono, fontSize: 10, letterSpacing: 3 }}>
              LOCAL LIBRARY
            </span>
            <span style={{ color: c.fainter, fontFamily: mono, fontSize: 9.5, letterSpacing: 1.5 }}>
              INDEXED ON THIS MACHINE ONLY
            </span>
          </div>

          <input
            ref={searchRef}
            value={query}
            onChange={(e) => void runSearch(e.target.value)}
            placeholder="Search your documents"
            aria-label="Search documents"
            style={{
              marginTop: 12,
              width: '100%',
              background: c.codeBg,
              border: `1px solid ${c.border}`,
              borderRadius: 6,
              padding: '10px 12px',
              color: c.text,
              fontFamily: mono,
              fontSize: 12.5,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {reading ? (
            <Reader reading={reading} onBack={() => setReading(null)} />
          ) : hits ? (
            <Results hits={hits} onOpen={open} />
          ) : (
            <Roots status={status} newRoot={newRoot} setNewRoot={setNewRoot} refresh={refresh} />
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '12px 24px 16px',
            borderTop: `1px solid ${c.border}`,
            flexWrap: 'wrap',
          }}
        >
          {status?.building ? (
            <>
              <span style={{ color: c.accent, fontFamily: mono, fontSize: 10, letterSpacing: 2 }}>
                INDEXING {status.indexed}/{status.scanned}
              </span>
              <Action
                label="STOP"
                onClick={async () => {
                  await cancelIndex()
                  void refresh()
                }}
              />
            </>
          ) : (
            <>
              <span
                style={{ color: c.faint, fontFamily: mono, fontSize: 10, letterSpacing: 2 }}
                title={
                  status
                    ? `${status.empty} files hold no extractable text (usually scanned PDFs), ` +
                      `${status.failed} could not be read at all`
                    : undefined
                }
              >
                {status ? `${status.documents.toLocaleString()} DOCUMENTS` : 'LOADING'}
                {status && status.empty > 0 ? ` · ${status.empty} SCANS (NO TEXT)` : ''}
                {status && status.failed > 0 ? ` · ${status.failed} UNREADABLE` : ''}
              </span>
              <Action
                label="REINDEX"
                onClick={async () => {
                  await reindex()
                  void refresh()
                }}
              />
            </>
          )}
          {hits && <Action label="BACK TO FOLDERS" onClick={() => void runSearch('')} />}
          <Action label="CLOSE" onClick={onClose} />
        </div>
      </div>
    </div>
  )
}

function Results({ hits, onOpen }: { hits: DocHit[]; onOpen: (h: DocHit) => void }) {
  if (hits.length === 0) {
    return (
      <p style={{ color: c.faint, fontFamily: sans, fontSize: 13.5, padding: '20px 24px' }}>
        Nothing matched. The index covers text, Markdown, code, PDF, Word, PowerPoint and Excel
        files.
      </p>
    )
  }
  return (
    <div style={{ padding: '8px 0' }}>
      {hits.map((h) => (
        <div key={h.id} style={{ borderBottom: `1px solid ${c.border}`, padding: '12px 24px' }}>
          {/* The row itself reads the document; the strip below hands it to the
              rest of the machine. Two different kinds of act, so two controls. */}
          <button
            type="button"
            onClick={() => onOpen(h)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ color: c.text, fontFamily: mono, fontSize: 12 }}>{h.name}</span>
              <span
                style={{ color: c.fainter, fontFamily: mono, fontSize: 9.5, marginLeft: 'auto' }}
              >
                {shortPath(h.path)}
              </span>
            </div>
            {h.passage && (
              <p
                style={{
                  color: c.faint,
                  fontFamily: sans,
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  margin: '6px 0 0',
                }}
              >
                {h.passage.text.slice(0, 220).replace(/\s+/g, ' ')}…
              </p>
            )}
          </button>
          <div style={{ display: 'flex', gap: 14, marginTop: 8, alignItems: 'baseline' }}>
            <Handoff id={h.id} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Reader({
  reading,
  onBack,
}: {
  reading: { name: string; path: string; text: string }
  onBack: () => void
}) {
  return (
    <div style={{ padding: '16px 24px' }}>
      <Action label="← BACK" onClick={onBack} />
      <div style={{ color: c.text, fontFamily: mono, fontSize: 12.5, marginTop: 12 }}>
        {reading.name}
      </div>
      <div style={{ color: c.fainter, fontFamily: mono, fontSize: 9.5, marginTop: 4 }}>
        {reading.path}
      </div>
      <pre
        style={{
          marginTop: 14,
          color: c.dim,
          fontFamily: mono,
          fontSize: 11.5,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {reading.text}
      </pre>
    </div>
  )
}

function Roots({
  status,
  newRoot,
  setNewRoot,
  refresh,
}: {
  status: DocsStatus | null
  newRoot: string
  setNewRoot: (v: string) => void
  refresh: () => Promise<void>
}) {
  return (
    <div style={{ padding: '16px 24px' }}>
      {status && status.documents === 0 && !status.building && (
        // Nothing is indexed until it is asked for, so the first run has to say
        // so out loud - otherwise the library looks broken and Ø looks like it
        // cannot read anything.
        <p
          style={{
            color: c.accent,
            fontFamily: sans,
            fontSize: 13.5,
            lineHeight: 1.7,
            margin: '0 0 16px',
          }}
        >
          Nothing is indexed yet. Choose <strong>REINDEX</strong> below to read the folders listed
          here. It runs entirely on this machine, and a first pass over a large disk takes a while.
        </p>
      )}

      <p style={{ color: c.faint, fontFamily: sans, fontSize: 13, lineHeight: 1.7, margin: 0 }}>
        Ø indexes these folders. Credential-shaped files (<code>.env</code>, keys, certificates)
        and machine folders like <code>node_modules</code> are never indexed.
      </p>

      <div style={{ marginTop: 16 }}>
        {(status?.roots ?? []).map((r) => (
          <div
            key={r}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '9px 0',
              borderBottom: `1px solid ${c.border}`,
            }}
          >
            <span style={{ color: c.text, fontFamily: mono, fontSize: 11.5, flex: 1 }}>{r}</span>
            <Action
              label="REMOVE"
              onClick={async () => {
                await removeRoot(r)
                void refresh()
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
        <input
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          placeholder="C:\\Users\\you\\Projects"
          aria-label="Folder to index"
          style={{
            flex: 1,
            background: c.codeBg,
            border: `1px solid ${c.border}`,
            borderRadius: 6,
            padding: '9px 11px',
            color: c.text,
            fontFamily: mono,
            fontSize: 11.5,
            outline: 'none',
          }}
        />
        <Action
          label="ADD FOLDER"
          onClick={async () => {
            if (!newRoot.trim()) return
            await addRoot(newRoot.trim())
            setNewRoot('')
            void refresh()
          }}
        />
      </div>
    </div>
  )
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
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
        color: hover ? c.text : c.faint,
        transition: 'color 160ms ease',
      }}
    >
      {label}
    </button>
  )
}
