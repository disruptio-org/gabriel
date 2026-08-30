/**
 * Microphone capture.
 *
 * Audio is held as a Blob in memory for the length of one request and handed to
 * the local service, which is the only process that talks to OpenAI. Nothing is
 * written to disk, nothing is kept after the transcript comes back, and no
 * recording is ever replayed - what survives a voice turn is its text.
 */

/** Everything that can go wrong, separated because each needs its own sentence. */
export type VoiceErrorKind =
  | 'no_key'
  | 'denied'
  | 'no_mic'
  | 'offline'
  | 'empty'
  | 'too_long'
  | 'rate_limit'
  | 'api'

export interface VoiceFailure {
  ok: false
  kind: VoiceErrorKind
  message: string
}
export type TranscriptResult = { ok: true; text: string } | VoiceFailure

/** Ordered by preference; the first the browser admits to supporting wins. */
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

function pickMimeType(): string {
  const supported = CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t))
  // Chromium always supports webm/opus; the fallback exists so a missing
  // isTypeSupported cannot stop a recording outright.
  return supported ?? 'audio/webm'
}

/**
 * One recording session. Constructed when the user starts, disposed when the
 * transcript is in hand - the microphone track is stopped either way, so the
 * OS recording indicator never outlives the recording.
 */
export class Recorder {
  private recorder: MediaRecorder
  private stream: MediaStream
  private chunks: Blob[] = []
  readonly mimeType: string

  private constructor(stream: MediaStream, mimeType: string) {
    this.stream = stream
    this.mimeType = mimeType
    this.recorder = new MediaRecorder(stream, { mimeType })
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
  }

  /**
   * Opens the microphone. Rejects with a VoiceFailure rather than a DOMException
   * so the caller has a sentence to show: a refused permission and an absent
   * microphone look similar in code and mean different things to the user.
   */
  static async open(): Promise<Recorder> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw {
          ok: false,
          kind: 'denied',
          // Windows has its own microphone switch, and it fails identically to
          // a refused browser permission - so both are named.
          message: 'Microphone access is blocked. Check Windows privacy settings.',
        } satisfies VoiceFailure
      }
      throw {
        ok: false,
        kind: 'no_mic',
        message: 'No microphone was found.',
      } satisfies VoiceFailure
    }
    return new Recorder(stream, pickMimeType())
  }

  /** Stops, releases the microphone, and resolves with what was captured. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        this.stream.getTracks().forEach((t) => t.stop())
        const audio = new Blob(this.chunks, { type: this.mimeType })
        // Dropped here rather than left for the garbage collector to reach
        // eventually: the recording exists for exactly as long as it is needed.
        this.chunks = []
        resolve(audio)
      }
      // Already inactive if the track ended under us; resolve rather than hang.
      if (this.recorder.state === 'inactive') this.recorder.onstop?.(new Event('stop'))
      else this.recorder.stop()
    })
  }

  /** Abandons the recording without transcribing it. */
  discard(): void {
    this.recorder.onstop = null
    if (this.recorder.state !== 'inactive') this.recorder.stop()
    this.stream.getTracks().forEach((t) => t.stop())
    this.chunks = []
  }
}

/** Sends one recording to the local service and returns what it heard. */
export async function transcribe(audio: Blob): Promise<TranscriptResult> {
  try {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'content-type': audio.type || 'audio/webm' },
      body: audio,
    })
    return (await res.json()) as TranscriptResult
  } catch {
    return { ok: false, kind: 'offline', message: 'The local Ø service is not running.' }
  }
}
