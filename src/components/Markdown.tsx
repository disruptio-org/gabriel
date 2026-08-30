import { createElement, Fragment, type ReactNode } from 'react'
import { c, mono, sans } from '../theme'

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/

/** Inline emphasis, code and links. Renders to React nodes, never to HTML. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let k = 0

  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      out.push(rest)
      break
    }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    const tok = m[0]

    if (tok.startsWith('`')) {
      out.push(
        <code
          key={`${key}-${k++}`}
          style={{
            fontFamily: mono,
            fontSize: '0.88em',
            background: '#101712',
            border: `1px solid ${c.borderSoft}`,
            borderRadius: 3,
            padding: '1px 5px',
            color: c.inlineCode,
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={`${key}-${k++}`} style={{ color: '#fff', fontWeight: 600 }}>
          {inline(tok.slice(2, -2), `${key}b${k}`)}
        </strong>,
      )
    } else if (tok.startsWith('*')) {
      out.push(<em key={`${key}-${k++}`}>{inline(tok.slice(1, -1), `${key}i${k}`)}</em>)
    } else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
      out.push(
        <a
          key={`${key}-${k++}`}
          href={link[2]}
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: c.accent }}
        >
          {link[1]}
        </a>,
      )
    }
    rest = rest.slice(m.index + tok.length)
  }
  return out
}

const bodyStyle = { fontFamily: sans, fontSize: 14.5, lineHeight: 1.68, color: c.text, margin: 0 }

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div
      style={{
        border: `1px solid ${c.borderSoft}`,
        borderRadius: 6,
        overflow: 'hidden',
        margin: '4px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '5px 12px',
          background: c.surface,
          borderBottom: `1px solid ${c.borderSoft}`,
        }}
      >
        <span style={{ color: c.faint, fontSize: 9.5, letterSpacing: 2, fontFamily: mono }}>
          {(lang || 'CODE').toUpperCase()}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={() => void navigator.clipboard.writeText(code)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void navigator.clipboard.writeText(code)
          }}
          style={{
            color: c.faint,
            fontSize: 9.5,
            letterSpacing: 2,
            cursor: 'pointer',
            fontFamily: mono,
          }}
        >
          COPY
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '12px 14px',
          overflowX: 'auto',
          background: c.codeBg,
          color: c.code,
          fontFamily: mono,
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        {code}
      </pre>
    </div>
  )
}

const cells = (row: string) =>
  row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((s) => s.trim())

/**
 * A deliberately small Markdown subset (FR-13). Everything is built as React
 * elements, so model output is never interpreted as markup.
 */
export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let k = 0

  while (i < lines.length) {
    const ln = lines[i]!

    if (ln.startsWith('~~~') || ln.startsWith('```')) {
      const fence = ln.slice(0, 3)
      const lang = ln.slice(3).trim()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith(fence)) code.push(lines[i++]!)
      i++
      blocks.push(<CodeBlock key={k++} lang={lang} code={code.join('\n')} />)
      continue
    }

    const heading = /^(#{1,4})\s+(.*)/.exec(ln)
    if (heading) {
      const level = heading[1]!.length
      // A real h1-h4 so the response has a navigable outline, not just big text.
      blocks.push(
        createElement(
          `h${level}`,
          {
            key: k++,
            style: {
              fontFamily: mono,
              fontWeight: 600,
              color: c.text,
              fontSize: level <= 2 ? 16 : 13.5,
              letterSpacing: 0.5,
              margin: '10px 0 2px',
            },
          },
          inline(heading[2]!, `h${k}`),
        ),
      )
      i++
      continue
    }

    // Table: a header row followed by a |---|---| delimiter row.
    const next = lines[i + 1]
    if (ln.includes('|') && next !== undefined && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(next)) {
      const head = cells(ln)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(cells(lines[i++]!))
      }
      blocks.push(
        <div key={k++} style={{ overflowX: 'auto', margin: '4px 0' }}>
          <table style={{ borderCollapse: 'collapse', ...bodyStyle, fontSize: 13.5 }}>
            <thead>
              <tr>
                {head.map((h, j) => (
                  <th
                    key={j}
                    style={{
                      textAlign: 'left',
                      padding: '6px 14px 6px 0',
                      borderBottom: `1px solid ${c.dim}`,
                      color: c.muted,
                      fontFamily: mono,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    {inline(h, `th${k}${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{
                        padding: '6px 14px 6px 0',
                        borderBottom: `1px solid ${c.border}`,
                        verticalAlign: 'top',
                      }}
                    >
                      {inline(cell, `td${k}${ri}${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(ln)) {
      const ordered = /^\s*\d+\.\s+/.test(ln)
      const items: { marker: string; text: string }[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]!)) {
        const num = /^\s*(\d+)\.\s+(.*)/.exec(lines[i]!)
        const bul = /^\s*[-*]\s+(.*)/.exec(lines[i]!)
        items.push({ marker: num ? `${num[1]}.` : '·', text: num ? num[2]! : bul![1]! })
        i++
      }
      // A real ul/ol: the marker glyph is drawn by hand to keep the design's
      // accent bullet, so it is hidden from assistive tech - the list element
      // already conveys count and position.
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        createElement(
          List,
          {
            key: k++,
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              margin: '2px 0',
              padding: 0,
              listStyle: 'none',
            },
          },
          items.map((it, j) => (
            <li key={j} style={{ display: 'flex', gap: 10 }}>
              <span
                aria-hidden="true"
                style={{
                  color: c.accent,
                  fontFamily: mono,
                  fontSize: 12.5,
                  lineHeight: '24px',
                  flex: '0 0 auto',
                  minWidth: 14,
                }}
              >
                {it.marker}
              </span>
              <div style={{ ...bodyStyle, flex: 1 }}>{inline(it.text, `li${k}${j}`)}</div>
            </li>
          )),
        ),
      )
      continue
    }

    if (ln.startsWith('>')) {
      // Consecutive '>' lines are one quote, not one per line.
      const quote: string[] = []
      while (i < lines.length && lines[i]!.startsWith('>')) {
        quote.push(lines[i++]!.replace(/^>\s?/, ''))
      }
      blocks.push(
        <blockquote
          key={k++}
          style={{
            ...bodyStyle,
            borderLeft: `2px solid ${c.dim}`,
            paddingLeft: 14,
            color: c.muted,
            margin: 0,
          }}
        >
          {inline(quote.join(' '), `q${k}`)}
        </blockquote>,
      )
      continue
    }

    if (/^\s*(---|\*\*\*)\s*$/.test(ln)) {
      blocks.push(
        <hr
          key={k++}
          style={{ height: 1, border: 'none', background: c.borderSoft, margin: '8px 0' }}
        />,
      )
      i++
      continue
    }

    if (ln.trim() === '') {
      i++
      continue
    }

    const para: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^(#|```|~~~|>|\s*([-*]|\d+\.)\s)/.test(lines[i]!)
    ) {
      para.push(lines[i++]!)
    }
    blocks.push(
      <p key={k++} style={bodyStyle}>
        {inline(para.join(' '), `p${k}`)}
      </p>,
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocks.map((b, j) => (
        <Fragment key={j}>{b}</Fragment>
      ))}
      {streaming && (
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 15,
            background: c.accent,
            animation: 'oBlink 1s steps(1) infinite',
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </div>
  )
}
