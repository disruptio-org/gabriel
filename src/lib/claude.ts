import type { ErrorKind, Message } from '../types'

interface StreamHandlers {
  onDelta: (text: string) => void
  onError: (kind: ErrorKind, message: string, detail?: string) => void
  onDone: () => void
}

export interface Health {
  connected: boolean
  models: string[]
  default: string
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
  h: StreamHandlers,
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
          | { type: 'done' }

        if (ev.type === 'delta') h.onDelta(ev.text)
        else if (ev.type === 'error') h.onError(ev.kind, ev.message, ev.detail)
        else h.onDone()
      }
    }
  } catch {
    if (!signal.aborted) h.onError('offline', 'The connection dropped mid-response.')
  }
}
