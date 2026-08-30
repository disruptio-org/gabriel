import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Recorder, transcribe, type VoiceFailure } from '../lib/voice'
import { c, mono } from '../theme'

const MAX_HEIGHT = 160

export function Composer({
  inputRef,
  busy,
  status,
  connected,
  onSend,
  onStop,
  onConnect,
  docs,
  onToggleDocs,
  voiceConnected,
  onConnectVoice,
  voiceConsent,
  onNeedVoiceConsent,
  startVoiceSignal,
  handsFree,
  onToggleHandsFree,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>
  busy: boolean
  status: string
  connected: boolean
  onSend: (text: string) => void
  onStop: () => void
  onConnect: () => void
  /** Whether a send searches the local library first. Consent is still per send. */
  docs: boolean
  onToggleDocs: () => void
  /** Whether an OpenAI key is stored. Voice is the only thing it gates. */
  voiceConnected: boolean
  onConnectVoice: () => void
  /** Whether the user has been told, once, where their recording goes. */
  voiceConsent: boolean
  onNeedVoiceConsent: () => void
  /**
   * Bumped by App when consent has just been given, so the click that raised
   * the question is the click that starts recording - the user should not have
   * to press the button twice.
   */
  startVoiceSignal: number
  /** Hands-free: the turn ends itself and sends. Mutually exclusive with DOCS. */
  handsFree: boolean
  onToggleHandsFree: () => void
}) {
  const [focused, setFocused] = useState(false)
  const [hoverSend, setHoverSend] = useState(false)
  // idle -> recording -> transcribing -> idle. Kept here rather than in App
  // because the transcript's destination is this component's textarea.
  const [voice, setVoice] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recorderRef = useRef<Recorder | null>(null)

  const submit = () => {
    const el = inputRef.current
    if (!el) return
    const text = el.value.trim()
    if (!text || busy) return
    el.value = ''
    el.style.height = 'auto'
    onSend(text)
  }

  /** Puts transcribed text where the user is typing, without sending it. */
  const insert = (text: string) => {
    const el = inputRef.current
    if (!el) return
    const existing = el.value
    el.value = existing ? `${existing.replace(/\s+$/, '')} ${text}` : text
    el.style.height = 'auto'
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`
    el.focus()
    // Caret at the end, so the next thing typed continues the sentence.
    el.setSelectionRange(el.value.length, el.value.length)
  }

  // Read inside callbacks that outlive the render which created them - the VAD
  // fires on a timer and must see the mode as it is now, not as it was.
  const handsFreeRef = useRef(handsFree)
  handsFreeRef.current = handsFree
  const sendRef = useRef(onSend)
  sendRef.current = onSend

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current
    if (!rec) return
    recorderRef.current = null
    const auto = handsFreeRef.current
    // Too short to be a sentence. In hands-free this happens on a cough or a
    // door, and the right response is to keep listening rather than to explain.
    if (auto && !rec.heardSpeech) {
      rec.discard()
      setVoice('idle')
      return void startRef.current?.()
    }
    setVoice('transcribing')
    const audio = await rec.stop()
    const result = await transcribe(audio)
    setVoice('idle')

    if (!result.ok) {
      // Silence in hands-free is not worth a message; anything else is, and it
      // stops the loop rather than retrying into the same failure.
      if (!(auto && result.kind === 'empty')) setVoiceError(result.message)
      if (auto && result.kind === 'empty') void startRef.current?.()
      return
    }
    // The whole difference between the two modes: hands-free commits the
    // sentence, dictation hands it back for the user to approve by pressing
    // Enter.
    if (auto) sendRef.current(result.text)
    else insert(result.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startRecording = useCallback(async () => {
    if (!voiceConnected) return onConnectVoice()
    // Asked before the microphone opens, never after: consent that arrives once
    // the recording is already running is not consent.
    if (!voiceConsent) return onNeedVoiceConsent()
    if (recorderRef.current) return
    setVoiceError(null)
    try {
      const rec = await Recorder.open()
      recorderRef.current = rec
      setVoice('recording')
      // In hands-free the turn ends itself; with the button, the user ends it.
      if (handsFreeRef.current) rec.listenForTurnEnd(() => void stopRecording())
    } catch (err) {
      setVoiceError((err as VoiceFailure).message)
      setVoice('idle')
    }
  }, [onConnectVoice, onNeedVoiceConsent, stopRecording, voiceConnected, voiceConsent])

  // Lets stopRecording restart the loop without the two callbacks depending on
  // each other in a cycle.
  const startRef = useRef<(() => void) | null>(null)
  startRef.current = () => void startRecording()

  const toggleVoice = useCallback(() => {
    if (voice === 'transcribing') return
    if (voice === 'recording') void stopRecording()
    else void startRecording()
  }, [startRecording, stopRecording, voice])

  // Ctrl+Space is the keyboard equivalent of the button, and Escape abandons a
  // recording rather than transcribing it - stopping is not the same as
  // cancelling, and the user needs both.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault()
        toggleVoice()
      }
      if (e.key === 'Escape' && recorderRef.current) {
        recorderRef.current.discard()
        recorderRef.current = null
        setVoice('idle')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleVoice])

  // Consent was just granted for the click that asked for it.
  const firstSignal = useRef(startVoiceSignal)
  useEffect(() => {
    if (startVoiceSignal === firstSignal.current) return
    firstSignal.current = startVoiceSignal
    void startRecording()
  }, [startRecording, startVoiceSignal])

  // Reopen the microphone when Ø has finished answering: that is what makes it
  // a conversation rather than a series of dictations. Guarded on handsFree so
  // an ordinary typed turn never opens the microphone behind the user's back.
  const wasBusy = useRef(busy)
  useEffect(() => {
    const finished = wasBusy.current && !busy
    wasBusy.current = busy
    if (finished && handsFree && voice === 'idle') void startRecording()
  }, [busy, handsFree, startRecording, voice])

  // Leaving hands-free closes the microphone it opened. Without this, turning
  // the mode off mid-listen would leave a live recording with nothing driving
  // it - the one state where the indicator would be lying.
  useEffect(() => {
    if (handsFree) return
    const rec = recorderRef.current
    if (rec && voice === 'recording') {
      rec.discard()
      recorderRef.current = null
      setVoice('idle')
    }
  }, [handsFree, voice])

  // A live microphone must not outlive the component that opened it.
  useEffect(() => () => recorderRef.current?.discard(), [])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div style={{ flex: '0 0 auto', padding: '14px 40px 22px' }}>
      <div
        style={{
          maxWidth: 680,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          border: `1px solid ${focused ? c.dim : c.border}`,
          background: c.surface,
          borderRadius: 8,
          padding: '11px 12px 11px 16px',
          transition: 'border-color 200ms',
        }}
      >
        <span style={{ color: c.dim, fontSize: 13, lineHeight: '22px', flex: '0 0 auto' }}>›</span>

        <textarea
          id="prompt"
          ref={inputRef}
          rows={1}
          placeholder="What are we thinking about?"
          aria-label="What are we thinking about?"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: c.text,
            fontFamily: mono,
            fontSize: 13.5,
            lineHeight: '22px',
            maxHeight: MAX_HEIGHT,
            padding: 0,
          }}
        />

        <MicButton
          state={voice}
          connected={voiceConnected}
          onClick={toggleVoice}
        />

        <button
          type="button"
          onClick={() => (busy ? onStop() : submit())}
          onMouseEnter={() => setHoverSend(true)}
          onMouseLeave={() => setHoverSend(false)}
          title={busy ? 'Stop (Esc)' : 'Send (Enter)'}
          aria-label={busy ? 'Stop generating' : 'Send'}
          style={{
            flex: '0 0 auto',
            width: 26,
            height: 26,
            padding: 0,
            borderRadius: 5,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: hoverSend ? c.accent : c.faint,
            background: hoverSend ? 'rgba(105,255,148,0.07)' : 'transparent',
            fontSize: 12,
            fontFamily: mono,
          }}
        >
          {busy ? '■' : '↵'}
        </button>
      </div>

      <div
        style={{
          maxWidth: 680,
          margin: '8px auto 0',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        {voiceError ? (
          // Replaces the shortcut hints rather than joining them: a failed
          // recording is the only thing worth reading at that moment.
          <span
            role="alert"
            style={{ color: c.warm, fontSize: 9.5, letterSpacing: 1.5, fontFamily: mono }}
          >
            {voiceError.toUpperCase()}
          </span>
        ) : connected ? (
          <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
            <span style={{ color: c.ghost, fontSize: 9.5, letterSpacing: 1.5, fontFamily: mono }}>
              {voice === 'recording'
                ? 'RECORDING · CTRL+SPACE STOP · ESC DISCARD'
                : voice === 'transcribing'
                  ? 'TRANSCRIBING'
                  : 'ENTER SEND · SHIFT+ENTER NEWLINE · ESC STOP'}
            </span>
            {/* Turning this off skips the local search entirely - no passages
                are found, so none can be offered. */}
            <button
              type="button"
              onClick={onToggleDocs}
              disabled={handsFree}
              title={
                handsFree
                  ? 'Documents need approval at the keyboard, which hands-free does not have'
                  : docs
                    ? 'Ø checks your local library and asks before sending anything from it (Ctrl+D to browse)'
                    : 'Ø ignores your documents entirely'
              }
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: handsFree ? 'not-allowed' : 'pointer',
                fontFamily: mono,
                fontSize: 9.5,
                letterSpacing: 1.5,
                color: handsFree ? c.ghost : docs ? c.dim : c.ghost,
                opacity: handsFree ? 0.45 : 1,
              }}
            >
              {handsFree ? 'DOCS OFF' : docs ? 'DOCS ON' : 'DOCS OFF'}
            </button>

            {/* Hands-free is a mode in which the app records and sends without
                the user touching anything, so its state is legible at rest
                rather than only while it is doing something. */}
            <button
              type="button"
              onClick={onToggleHandsFree}
              disabled={!voiceConnected}
              title={
                !voiceConnected
                  ? 'Voice needs an OpenAI connection'
                  : handsFree
                    ? 'Ø listens, sends when you stop speaking, and listens again (Esc to leave)'
                    : 'Speak and Ø answers without you pressing anything — turns DOCS off'
              }
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: voiceConnected ? 'pointer' : 'not-allowed',
                fontFamily: mono,
                fontSize: 9.5,
                letterSpacing: 1.5,
                color: handsFree ? c.accent : c.ghost,
                opacity: voiceConnected ? 1 : 0.45,
              }}
            >
              {handsFree ? 'VOICE ON' : 'VOICE OFF'}
            </button>
          </span>
        ) : (
          // The fix is one click away rather than a line of documentation.
          <button
            type="button"
            onClick={onConnect}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: c.warm,
              fontSize: 9.5,
              letterSpacing: 1.5,
              fontFamily: mono,
              textAlign: 'left',
            }}
          >
            Ø NEEDS A CLAUDE CONNECTION — CONNECT
          </button>
        )}
        <span
          style={{
            color: c.ghost,
            fontSize: 9.5,
            letterSpacing: 1.5,
            fontFamily: mono,
            flex: '0 0 auto',
          }}
        >
          {status}
        </span>
      </div>
    </div>
  )
}

/**
 * The microphone. Recording is a state the user is *in*, so it is unmistakable
 * at rest: a filled dot in the accent colour, and the footer says so in words.
 *
 * Without an OpenAI key the button stays visible but inert - it explains what
 * is missing on hover and opens the connection dialog, which is more useful
 * than hiding the feature and leaving the user to wonder whether it exists.
 */
function MicButton({
  state,
  connected,
  onClick,
}: {
  state: 'idle' | 'recording' | 'transcribing'
  connected: boolean
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  const recording = state === 'recording'
  const working = state === 'transcribing'

  const title = !connected
    ? 'Voice needs an OpenAI connection — click to add one'
    : recording
      ? 'Stop and transcribe (Ctrl+Space) · Esc discards'
      : 'Speak instead of typing (Ctrl+Space)'

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={working}
      title={title}
      aria-label={title}
      aria-pressed={recording}
      style={{
        flex: '0 0 auto',
        width: 26,
        height: 26,
        padding: 0,
        borderRadius: 5,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: working ? 'default' : 'pointer',
        color: recording ? c.accent : !connected ? c.ghost : hover ? c.accent : c.faint,
        background: recording || hover ? 'rgba(105,255,148,0.07)' : 'transparent',
        fontSize: 12,
        fontFamily: mono,
        // Reduced motion is honoured globally in styles.css; this is the only
        // pulse in the composer and it exists to make a live microphone
        // impossible to miss.
        animation: recording ? 'oPulse 1.6s ease-in-out infinite' : undefined,
      }}
    >
      {working ? '⋯' : recording ? '●' : '◉'}
    </button>
  )
}
