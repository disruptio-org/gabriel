// Speech to text.
//
// The renderer records audio and posts the bytes here; this module is the only
// place they are sent anywhere. That is deliberate and it is the same rule the
// document library follows: the credential lives in this process, and what
// leaves the machine leaves from one readable place (§16).
//
// What is promised to the user, and enforced below: the recording is held in
// memory for the length of one request and is never written to disk, never
// logged, and never kept after the transcript comes back.
import { hasKey, keyOf } from './providers.mjs'

const PROVIDER = 'openai'
const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'

// Lower word error rate than whisper-1, and noticeably better on speech that
// switches language mid-sentence.
const MODEL = 'gpt-4o-transcribe'

// The API's own limit. The renderer stops recording long before this - a 60s
// opus clip is well under a megabyte - so reaching it means something has gone
// wrong upstream, and a clear refusal beats a rejected upload.
export const MAX_BYTES = 25 * 1024 * 1024

/**
 * Transcribes one recording.
 *
 * Returns `{ ok: true, text }`, or `{ ok: false, kind, message }` where kind is
 * one the renderer can act on differently: no_key sends the user to the
 * connection dialog, offline is worth retrying, api is not.
 */
export async function transcribe(audio, mimeType) {
  if (!hasKey(PROVIDER)) {
    return { ok: false, kind: 'no_key', message: 'Voice needs an OpenAI connection.' }
  }
  if (audio.byteLength === 0) {
    return { ok: false, kind: 'empty', message: 'Nothing was recorded.' }
  }
  if (audio.byteLength > MAX_BYTES) {
    return { ok: false, kind: 'too_long', message: 'That recording is too long to transcribe.' }
  }

  const form = new FormData()
  // The extension has to match the container or the API rejects the upload;
  // the renderer negotiates the codec and tells us which one it settled on.
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
  form.append('file', new Blob([audio], { type: mimeType }), `speech.${ext}`)
  form.append('model', MODEL)
  form.append('response_format', 'text')

  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${keyOf(PROVIDER)}` },
      body: form,
    })
  } catch (err) {
    console.error('[svc] transcribe unreachable:', err.message)
    return { ok: false, kind: 'offline', message: "I couldn't reach OpenAI." }
  }

  if (!res.ok) {
    // The body may carry a useful reason, but it is OpenAI's prose and may
    // quote the request - it is logged, not shown.
    console.error(`[svc] transcribe failed ${res.status}:`, (await res.text()).slice(0, 200))
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: 'no_key', message: 'OpenAI rejected the stored key.' }
    }
    if (res.status === 429) {
      return { ok: false, kind: 'rate_limit', message: 'OpenAI is limiting requests.' }
    }
    return { ok: false, kind: 'api', message: "That recording couldn't be transcribed." }
  }

  const text = (await res.text()).trim()
  // Silence transcribes to nothing, or to a stray punctuation mark. Either way
  // there is no sentence here, and saying so beats pasting noise into the
  // composer.
  if (!text || !/\p{L}|\p{N}/u.test(text)) {
    return { ok: false, kind: 'empty', message: 'I did not catch anything.' }
  }
  return { ok: true, text }
}
