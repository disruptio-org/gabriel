import { useCallback, useEffect, useRef, useState } from 'react'
import { Boot } from './components/Boot'
import { Chat } from './components/Chat'
import { Composer } from './components/Composer'
import { Approval } from './components/Approval'
import { Connection } from './components/Connection'
import { VoiceConsent } from './components/VoiceConsent'
import { Library } from './components/Library'
import { Desktop } from './components/Desktop'
import { effectiveMotion, loadConfig, saveConfig } from './config'
import { checkHealth, streamChat, PRIMARY } from './lib/claude'
import type { ProviderId, ProviderStatus } from './lib/claude'
import { searchDocs, type Attachment, type DocHit } from './lib/docs'
import { isDesktopApp, shell } from './lib/shell'
import { c, ease, mono } from './theme'
import type { FoundInTurn, Message, Phase } from './types'

const THINK_LABELS = ['thinking', 'examining assumptions', 'considering alternatives', 'synthesizing']

const uid = () => crypto.randomUUID()

function ChromeButton({
  label,
  title,
  onClick,
  danger,
}: {
  label: string
  title: string
  onClick: () => void
  danger?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      aria-label={title}
      style={{
        WebkitAppRegion: 'no-drag',
        width: 44,
        height: 38,
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontFamily: mono,
        fontSize: label === '+' ? 14 : 12,
        color: hover ? (danger ? c.text : label === '+' ? c.accent : c.text) : c.faint,
        background: hover
          ? danger
            ? 'rgba(200,80,70,0.55)'
            : label === '+'
              ? 'rgba(105,255,148,0.05)'
              : 'rgba(232,238,233,0.05)'
          : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  )
}

export default function App() {
  const [config, setConfig] = useState(loadConfig)
  const [phase, setPhase] = useState<Phase>('desktop')
  const [maxed, setMaxed] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [thinking, setThinking] = useState(false)
  const [thinkLabel, setThinkLabel] = useState(THINK_LABELS[0]!)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)
  const [providers, setProviders] = useState<Record<ProviderId, ProviderStatus> | null>(null)
  const [showConnection, setShowConnection] = useState(false)
  // Which provider the dialog opens on. Reaching for voice without a key should
  // land on the OpenAI tab, not on Claude's.
  const [connectionTab, setConnectionTab] = useState<ProviderId | null>(null)
  const [askVoiceConsent, setAskVoiceConsent] = useState(false)
  // Incremented once consent is granted, which tells the composer to start the
  // recording the user already asked for.
  const [startVoiceSignal, setStartVoiceSignal] = useState(0)
  // Hands-free and DOCS are mutually exclusive: the approval sheet needs someone
  // at the keyboard to tick passages, and hands-free is defined by there not
  // being one. Rather than let one silently weaken the other, each turns the
  // other off, visibly.
  const [handsFree, setHandsFree] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  // Consent is per send: this only decides whether the local search runs at all.
  const [useDocs, setUseDocs] = useState(true)
  const [pending, setPending] = useState<{ text: string; next: Message[]; hits: DocHit[] } | null>(
    null,
  )
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })

  /**
   * Whether this send searches the library at all. Derived rather than stored,
   * so the footer and the send path cannot disagree - if the composer says DOCS
   * OFF, no search runs, which is the whole promise of the exclusion.
   */
  const docsActive = useDocs && !handsFree
  // Read inside the streaming callback, which is deliberately not rebuilt when
  // the switch moves - a regenerate must use the setting as it stands now.
  const docsActiveRef = useRef(docsActive)
  docsActiveRef.current = docsActive

  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const convoRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamingIdRef = useRef<string | null>(null)
  const labelTimer = useRef<number | null>(null)

  const motion = effectiveMotion(config.animationMode)

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const refreshHealth = useCallback(async () => {
    const h = await checkHealth()
    // Only the primary provider decides whether the app is usable; a second
    // provider's credential gates its own feature, never the conversation.
    setProviders(h?.providers ?? null)
    setConnected(h?.providers?.[PRIMARY]?.connected ?? false)
  }, [])

  useEffect(() => {
    void refreshHealth()
  }, [refreshHealth])

  const focusPrompt = useCallback(() => {
    window.setTimeout(() => promptRef.current?.focus(), 350)
  }, [])

  const scrollBottom = useCallback(() => {
    const el = convoRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const stopLabels = useCallback(() => {
    if (labelTimer.current !== null) {
      clearInterval(labelTimer.current)
      labelTimer.current = null
    }
  }, [])

  /** Ends the active turn, keeping whatever text already arrived. */
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    stopLabels()
    setThinking(false)

    const id = streamingIdRef.current
    if (id) {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, stopped: true } : m)))
      streamingIdRef.current = null
      setStreamingId(null)
    }
  }, [stopLabels])

  const generate = useCallback(
    (history: Message[], attachments: Attachment[] = []) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setThinking(true)
      setThinkLabel(THINK_LABELS[0]!)
      stopLabels()
      let li = 0
      labelTimer.current = window.setInterval(() => {
        li = (li + 1) % THINK_LABELS.length
        setThinkLabel(THINK_LABELS[li]!)
      }, 1700)

      // The assistant turn is created by the first delta, so the thinking state
      // gives way the instant real output arrives - never on a timer.
      let assistantId: string | null = null
      // Searches land before the first delta, so they are held until there is
      // an assistant turn to attach them to.
      const found: FoundInTurn[] = []

      void streamChat(history, config.model, controller.signal, attachments, {
        onDelta: (text) => {
          if (assistantId === null) {
            assistantId = uid()
            streamingIdRef.current = assistantId
            stopLabels()
            setThinking(false)
            setStreamingId(assistantId)
            setMessages((prev) => [
              ...prev,
              { id: assistantId!, role: 'assistant', content: text, found: [...found] },
            ])
          } else {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)),
            )
          }
          scrollBottom()
        },
        onSearching: () => {
          // The label says what is actually happening; a search takes long
          // enough that "thinking" would be a small lie.
          stopLabels()
          setThinkLabel('searching your documents')
        },
        onResults: (query, results) => {
          found.push({ query, results })
          // If the turn already exists, the results belong on it now rather
          // than at the end of the stream.
          if (assistantId !== null) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, found: [...found] } : m)),
            )
          }
          scrollBottom()
        },
        onError: (kind, message, detail) => {
          if (controller.signal.aborted) return
          stopLabels()
          setThinking(false)
          setStreamingId(null)
          streamingIdRef.current = null
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: 'assistant', content: message, error: kind, detail },
          ])
          if (kind === 'no_key' || kind === 'auth') setConnected(false)
          scrollBottom()
        },
        onDone: () => {
          stopLabels()
          setThinking(false)
          setStreamingId(null)
          streamingIdRef.current = null
          scrollBottom()
        },
      },
      // Ø may search only when the library is in play at all - the same switch
      // that governs the approval sheet, so DOCS OFF means DOCS OFF.
      docsActiveRef.current,
      )
    },
    [config.model, scrollBottom, stopLabels],
  )

  /**
   * A send is a two-step act when the local library has something to say about
   * the question: search happens on this machine, and the passages it finds are
   * shown for approval before any of them travel. Answering "no" still sends
   * the question - only the document text is withheld.
   */
  const send = useCallback(
    async (text: string) => {
      const next: Message[] = [...messages, { id: uid(), role: 'user', content: text }]
      if (docsActive) {
        const hits = (await searchDocs(text, 5)).filter((h) => h.passage && h.passage.hits > 0)
        if (hits.length > 0) {
          setPending({ text, next, hits })
          return
        }
      }
      setMessages(next)
      generate(next)
      scrollBottom()
    },
    [docsActive, generate, messages, scrollBottom],
  )

  /** Drops trailing assistant turns and re-runs from the last user message. */
  const regenerate = useCallback(() => {
    abortRef.current?.abort()
    const trimmed = [...messages]
    while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.role === 'assistant') trimmed.pop()
    setMessages(trimmed)
    streamingIdRef.current = null
    setStreamingId(null)
    if (trimmed.length > 0) generate(trimmed)
  }, [generate, messages])

  const newConversation = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    stopLabels()
    setMessages([])
    setThinking(false)
    setStreamingId(null)
    streamingIdRef.current = null
    focusPrompt()
  }, [focusPrompt, stopLabels])

  const toDesktop = useCallback(() => {
    stopGeneration()
    setPhase('desktop')
  }, [stopGeneration])

  // Under the desktop shell these drive the real OS window; in a browser tab
  // they fall back to the in-page window the design draws for itself.
  const onMinimize = useCallback(() => {
    if (shell) void shell.minimize()
    else toDesktop()
  }, [toDesktop])

  const onToggleMaximize = useCallback(() => {
    if (shell) void shell.toggleMaximize()
    else setMaxed((v) => !v)
  }, [])

  const onClose = useCallback(() => {
    if (shell) void shell.close()
    else toDesktop()
  }, [toDesktop])

  // The shell owns the maximized flag once it exists - the window can also be
  // maximized by double-clicking the titlebar or by Windows itself.
  useEffect(() => {
    if (!shell) return
    void shell.isMaximized().then(setMaxed)
    return shell.onMaximizeChange(setMaxed)
  }, [])

  // A phase change resizes the real window rather than a div.
  useEffect(() => {
    if (shell && phase !== 'boot') void shell.setPhase(phase === 'desktop' ? 'desktop' : 'chat')
  }, [phase])

  const launch = useCallback(() => {
    if (motion === 'off') {
      setPhase('chat')
      focusPrompt()
    } else {
      setPhase('boot')
    }
  }, [focusPrompt, motion])

  useEffect(() => {
    if (phase !== 'chat') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopGeneration()
        // Escape means "stop what is happening", and in hands-free the thing
        // happening includes the app's intention to listen again.
        setHandsFree(false)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newConversation()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowConnection(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setShowLibrary(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newConversation, phase, stopGeneration])

  useEffect(() => () => abortRef.current?.abort(), [])

  const isBoot = phase === 'boot'
  // In the desktop app the OS window IS the window, so the frame fills the
  // surface; in a browser tab the design's floating window is drawn instead.
  const width = isDesktopApp
    ? '100%'
    : isBoot
      ? 560
      : maxed
        ? viewport.w - 4
        : Math.min(1020, viewport.w - 60)
  const height = isDesktopApp
    ? '100%'
    : isBoot
      ? 400
      : maxed
        ? viewport.h - 4
        : Math.round(viewport.h * 0.78)
  const busy = thinking || streamingId !== null

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: isDesktopApp
          ? 'transparent'
          : 'radial-gradient(ellipse 120% 90% at 50% 30%, #08100b 0%, #050706 55%, #030404 100%)',
        fontFamily: mono,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {phase === 'desktop' ? (
        <Desktop onLaunch={launch} />
      ) : (
        <div
          style={{
            position: 'absolute',
            ...(isDesktopApp
              ? { inset: 0 }
              : { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }),
            width,
            height,
            background: c.void,
            border: `1px solid ${c.border}`,
            borderRadius: maxed ? 0 : 10,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: isDesktopApp
              ? 'none'
              : '0 30px 90px rgba(0,0,0,0.7), 0 0 70px rgba(105,255,148,0.05)',
            transition: isDesktopApp
              ? 'border-radius 300ms'
              : `width 650ms ${ease}, height 650ms ${ease}, border-radius 300ms`,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 0 0 16px',
              userSelect: 'none',
              WebkitAppRegion: 'drag',
              flex: '0 0 auto',
              borderBottom: '1px solid rgba(105,255,148,0.06)',
              opacity: isBoot ? 0.25 : 1,
              transition: 'opacity 500ms ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: c.accent, fontSize: 14, fontWeight: 600 }}>Ø</span>
              <span style={{ color: c.muted, fontSize: 10, letterSpacing: 3 }}>
                PERSONAL INTELLIGENCE
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'stretch', height: 38 }}>
              <ChromeButton label="+" title="New conversation (Ctrl+N)" onClick={newConversation} />
              <ChromeButton label="─" title="Minimize" onClick={onMinimize} />
              <ChromeButton
                label={maxed ? '❐' : '▢'}
                title={maxed ? 'Restore' : 'Maximize'}
                onClick={onToggleMaximize}
              />
              <ChromeButton label="✕" title="Close" onClick={onClose} danger />
            </div>
          </div>

          {isBoot ? (
            <Boot
              userName={config.userName.trim() || 'Iago'}
              reduced={motion === 'reduced'}
              onDone={() => {
                setPhase('chat')
                focusPrompt()
              }}
            />
          ) : (
            <>
              <Chat
                messages={messages}
                thinking={thinking}
                thinkLabel={thinkLabel}
                streamingId={streamingId}
                convoRef={convoRef}
                onRegenerate={regenerate}
                onConnect={() => setShowConnection(true)}
              />
              <Composer
                inputRef={promptRef}
                busy={busy}
                connected={connected}
                onConnect={() => setShowConnection(true)}
                docs={docsActive}
                onToggleDocs={() => {
                  setUseDocs((v) => !v)
                  setHandsFree(false)
                }}
                handsFree={handsFree}
                onToggleHandsFree={() => setHandsFree((v) => !v)}
                voiceConnected={providers?.openai?.connected ?? false}
                onConnectVoice={() => setConnectionTab('openai')}
                voiceConsent={config.voiceConsent}
                onNeedVoiceConsent={() => setAskVoiceConsent(true)}
                startVoiceSignal={startVoiceSignal}
                status={thinking ? 'REASONING' : streamingId ? 'STREAMING' : 'READY'}
                onSend={send}
                onStop={stopGeneration}
              />
            </>
          )}

          {pending && (
            <Approval
              question={pending.text}
              hits={pending.hits}
              onSend={(attachments) => {
                const { next } = pending
                setPending(null)
                setMessages(next)
                generate(next, attachments)
                scrollBottom()
                focusPrompt()
              }}
              onCancel={() => {
                setPending(null)
                focusPrompt()
              }}
            />
          )}

          {askVoiceConsent && (
            <VoiceConsent
              onAccept={() => {
                const next = { ...config, voiceConsent: true }
                setConfig(next)
                saveConfig(next)
                setAskVoiceConsent(false)
                setStartVoiceSignal((n) => n + 1)
              }}
              onCancel={() => {
                setAskVoiceConsent(false)
                focusPrompt()
              }}
            />
          )}

          {showLibrary && <Library onClose={() => setShowLibrary(false)} />}

          {(showConnection || connectionTab) && (
            <Connection
              providers={providers}
              initial={connectionTab ?? PRIMARY}
              onClose={() => {
                setShowConnection(false)
                setConnectionTab(null)
              }}
              onDone={() => {
                setShowConnection(false)
                setConnectionTab(null)
                void refreshHealth()
                focusPrompt()
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
