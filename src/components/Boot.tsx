import { useEffect, useMemo, useRef, useState } from 'react'
import { c, ease, mono } from '../theme'
import { Glyph } from './Glyph'

interface Fragment {
  ch: string
  x0: number
  y0: number
  tx: number
  ty: number
  d: number
}

interface BootState {
  cursor: boolean
  showChars: boolean
  converged: boolean
  glyph: boolean
  up: boolean
  pulse: boolean
  micro: string
  g1: string
  g2: string
}

const IDLE: BootState = {
  cursor: false,
  showChars: false,
  converged: false,
  glyph: false,
  up: false,
  pulse: false,
  micro: '',
  g1: '',
  g2: '',
}

const CHARSET = '01<>/\\{}[]#$%&*+=?ØΔλΣ:;.'.split('')

/** 30 fragments: 22 around the ring, 8 along the diagonal incision. */
function makeFragments(): Fragment[] {
  const out: Fragment[] = []
  for (let i = 0; i < 30; i++) {
    let tx: number
    let ty: number
    if (i < 22) {
      const a = (i / 22) * Math.PI * 2
      tx = Math.cos(a) * 56
      ty = Math.sin(a) * 56
    } else {
      const t = ((i - 22) / 7) * 2 - 1
      tx = t * 76
      ty = -t * 76
    }
    out.push({
      ch: CHARSET[Math.floor(Math.random() * CHARSET.length)]!,
      x0: (Math.random() - 0.5) * 460,
      y0: (Math.random() - 0.5) * 300,
      tx,
      ty,
      d: Math.random() * 250,
    })
  }
  return out
}

/**
 * Sequences A-E from requirements §7: invocation, formation, awakening,
 * greeting, transformation. ~3.65s end to end, and skippable at any point -
 * a fast user is never held behind the animation.
 */
export function Boot({
  userName,
  reduced,
  onDone,
}: {
  userName: string
  reduced: boolean
  onDone: () => void
}) {
  const greeting = `Hello, ${userName}.`
  const question = 'What are we thinking about?'

  const fragments = useMemo(makeFragments, [])
  const [s, setS] = useState<BootState>(IDLE)
  const timers = useRef<number[]>([])
  const done = useRef(false)

  const finish = useRef(onDone)
  finish.current = onDone

  useEffect(() => {
    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms))
    }
    const patch = (p: Partial<BootState>) => setS((prev) => ({ ...prev, ...p }))

    const complete = () => {
      if (done.current) return
      done.current = true
      finish.current()
    }

    if (reduced) {
      // Reduced motion: land on the finished frame, hold briefly, continue.
      setS({
        ...IDLE,
        converged: true,
        glyph: true,
        up: true,
        pulse: true,
        g1: greeting,
        g2: question,
      })
      at(900, complete)
    } else {
      // A - invocation
      at(200, () => patch({ cursor: true }))
      at(420, () => patch({ showChars: true }))
      // B - formation
      at(650, () => patch({ converged: true, cursor: false }))
      at(700, () => patch({ micro: 'INITIALIZING' }))
      at(1000, () => patch({ micro: 'CONTEXT: READY' }))
      at(1300, () => patch({ micro: 'REASONING: ONLINE' }))
      // C - awakening
      at(1550, () => patch({ micro: '', glyph: true }))
      at(1850, () => patch({ showChars: false, pulse: true, up: true }))
      // D - greeting
      for (let i = 1; i <= greeting.length; i++) {
        at(2100 + i * 34, () => patch({ g1: greeting.slice(0, i) }))
      }
      for (let i = 1; i <= question.length; i++) {
        at(2850 + i * 24, () => patch({ g2: question.slice(0, i) }))
      }
      // E - transformation
      at(3650, complete)
    }

    // Any keypress or click accelerates straight to the ready state.
    const skip = () => complete()
    window.addEventListener('keydown', skip)

    const scheduled = timers.current
    return () => {
      window.removeEventListener('keydown', skip)
      scheduled.forEach(clearTimeout)
      timers.current = []
    }
  }, [greeting, question, reduced])

  return (
    <div
      onClick={() => {
        if (!done.current) {
          done.current = true
          onDone()
        }
      }}
      style={{ flex: 1, position: 'relative', cursor: 'default' }}
    >
      {s.cursor && (
        <span
          style={{
            position: 'absolute',
            left: '50%',
            top: '46%',
            transform: 'translate(-50%,-50%)',
            color: c.accent,
            fontSize: 16,
            animation: 'oBlink 0.9s steps(1) infinite',
          }}
        >
          _
        </span>
      )}

      {s.showChars && (
        <div style={{ position: 'absolute', left: '50%', top: '44%', width: 0, height: 0 }}>
          {fragments.map((f, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                color: c.accent,
                fontSize: 11,
                fontFamily: mono,
                opacity: s.converged ? (s.glyph ? 0 : 0.75) : 0.3,
                transform: `translate(${s.converged ? f.tx : f.x0}px, ${s.converged ? f.ty : f.y0}px)`,
                transition: `transform 750ms ${ease} ${f.d}ms, opacity 500ms ease ${s.glyph ? 0 : f.d}ms`,
              }}
            >
              {f.ch}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: s.up ? '30%' : '44%',
          transform: 'translate(-50%,-50%)',
          opacity: s.glyph ? 1 : 0,
          transition: `top 700ms ${ease}, opacity 600ms ease`,
          animation: s.pulse ? 'oPulse 4s ease-in-out infinite' : 'none',
        }}
      >
        <Glyph size={120} mode="ready" />
      </div>

      {s.micro && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '14%',
            transform: 'translateX(-50%)',
            color: c.fainter,
            fontSize: 9.5,
            letterSpacing: 4,
            fontFamily: mono,
          }}
        >
          {s.micro}
        </div>
      )}

      {s.g1 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '56%',
            transform: 'translateX(-50%)',
            color: c.text,
            fontSize: 17,
            whiteSpace: 'nowrap',
            fontFamily: mono,
          }}
        >
          {s.g1}
        </div>
      )}

      {s.g2 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '65%',
            transform: 'translateX(-50%)',
            color: c.muted,
            fontSize: 13.5,
            whiteSpace: 'nowrap',
            fontFamily: mono,
          }}
        >
          {s.g2}
          <span style={{ color: c.accent, animation: 'oBlink 0.9s steps(1) infinite' }}> _</span>
        </div>
      )}
    </div>
  )
}
