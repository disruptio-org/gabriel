import type { Attachment } from './docs'
import type { ErrorKind, Message } from '../types'

/**
 * One document Ø turned up while answering.
 *
 * Names and metadata only, mirroring what the service tells Claude - there is
 * no passage here, because nothing has been read. Acting on one of these is the
 * user's move.
 */
export interface FoundDoc {
  id: string
  name: string
  folder: string
  ext: string
  size_kb: number
  modified: string
  copies?: number
}

interface StreamHandlers {
  onDelta: (text: string) => void
  onError: (kind: ErrorKind, message: string, detail?: string) => void
  onDone: () => void
  /** Ø has started a search; the query is its words, not the user's. */
  onSearching?: (query: string) => void
  /** What that search returned, handed over as it happens rather than at the end. */
  onResults?: (query: string, results: FoundDoc[]) => void
}

/** Which provider a credential belongs to. Mirrors server/providers.mjs. */
export type ProviderId = 'anthropic' | 'openai'

/** The primary provider: without it there is no app, only a connect prompt. */
export const PRIMARY: ProviderId = 'anthropic'

export const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai']

/**
 * What the connection dialog needs to say about each provider. The prefix
 * duplicates a rule the service also enforces - deliberately, so an obviously
 * malformed key costs no round trip. The service stays authoritative.
 */
export const PROVIDER_UI: Record<
  ProviderId,
  { tab: string; prefix: string; placeholder: string; purpose: string; malformed: string }
> = {
  anthropic: {
    tab: 'CLAUDE',
    prefix: 'sk-ant-',
    placeholder: 'sk-ant-...',
    purpose: 'Ø needs a Claude API key to think. It is verified, then stored on this machine only.',
    malformed: 'That does not look like an Anthropic API key.',
  },
  openai: {
    tab: 'OPENAI',
    prefix: 'sk-',
    placeholder: 'sk-...',
    purpose:
      'Voice needs an OpenAI API key to turn speech into text. Optional - without it, ' +
      'everything else works exactly as it does now.',
    malformed: 'That does not look like an OpenAI API key.',
  },
}

export interface ProviderStatus {
  label: string
  connected: boolean
  /** Last four characters of the stored key. Never the key itself (§16). */
  hint: string | null
}

export interface Health {
  providers: Record<ProviderId, ProviderStatus>
  models: string[]
  default: string
}

export interface KeyResult {
  ok: boolean
  hint?: string | null
  error?: string
  warning?: string
}

/**
 * Hands a key to the local service, which verifies it against that provider
 * before storing it. The key is never kept in renderer state beyond this call.
 */
export async function saveKey(provider: ProviderId, key: string): Promise<KeyResult> {
  try {
    const res = await fetch('/api/key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    })
    return (await res.json()) as KeyResult
  } catch {
    return { ok: false, error: 'The local Ø service is not running.' }
  }
}

export async function clearKey(provider: ProviderId): Promise<void> {
  try {
    await fetch(`/api/key?provider=${provider}`, { method: 'DELETE' })
  } catch {
    /* nothing to do - the UI refreshes from health either way */
  }
}

export async function checkHealth(): Promise<Health | null> {
  try {
    const res = await fetch('/api/health')
    return (await res.json()) as Health
  } catch {
    return null
  }
}

/**
 * Streams one assistant turn from the local service. Text is handed over as it
 * arrives - nothing is buffered to pace an animation (§17).
 */
export async function streamChat(
  messages: Message[],
  model: string,
  signal: AbortSignal,
  attachments: Attachment[],
  h: StreamHandlers,
  /** Whether Ø may search the library this turn. Off in hands-free, as DOCS is. */
  docs = true,
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        // Failed turns carry no meaning for the model; drop them from context.
        messages: messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
        // References only - the service resolves them to the passages the user
        // approved, from its own copy. No document text is sent from here.
        attachments,
        docs,
      }),
    })
  } catch {
    // The local service itself is unreachable - distinct from Claude being down.
    h.onError('offline', 'The local Ø service is not running.')
    return
  }

  if (!res.ok || !res.body) {
    h.onError('api', "I couldn't reach Claude.", `service responded ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const ev = JSON.parse(line.slice(6)) as
          | { type: 'delta'; text: string }
          | { type: 'error'; kind: ErrorKind; message: string; detail?: string }
          | { type: 'searching'; query: string }
          | { type: 'results'; query: string; results: FoundDoc[] }
          | { type: 'done' }

        if (ev.type === 'delta') h.onDelta(ev.text)
        else if (ev.type === 'error') h.onError(ev.kind, ev.message, ev.detail)
        else if (ev.type === 'searching') h.onSearching?.(ev.query)
        else if (ev.type === 'results') h.onResults?.(ev.query, ev.results)
        else h.onDone()
      }
    }
  } catch {
    if (!signal.aborted) h.onError('offline', 'The connection dropped mid-response.')
  }
}
