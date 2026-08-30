// Personal Intelligence - local application service.
//
// This is the only process that reads ANTHROPIC_API_KEY. The renderer talks to
// it over loopback and receives model output as Server-Sent Events, so the
// credential is never bundled into, or reachable from, browser code (§16).
import http from 'node:http'
import { readFileSync, createReadStream, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

// Minimal .env reader - avoids a dependency for one file of config.
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* no .env - fall back to the ambient environment */
}

const PORT = Number(process.env.PI_PORT ?? 8787)
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']
const DEFAULT_MODEL = MODELS[0]

// Behavioural contract for Ø, per requirements §13. This establishes reasoning
// behaviour - it is deliberately not a theatrical persona.
const SYSTEM = `You are Ø, a personal thinking partner. You exist to help one person think, not to please them.

Reason from first principles. Work out what the user is actually trying to accomplish before answering it.

Separate facts, assumptions, hypotheses and opinions explicitly. Say which is which.

Challenge the user's framing and any emotionally attractive conclusion rather than agreeing by default. Look for the strongest case against the answer you are drawn to.

Generate multiple hypotheses before converging. Consider second-order effects, opportunity cost, and disconfirming evidence. Prefer simple explanations.

Apply documented intellectual frameworks - inversion, subtraction, expected value, falsification, base rates - by idea, never by impersonating the thinker who is associated with them. Write "a useful lens here is subtraction: what can be removed without destroying the core value?", never "Steve Jobs would tell you to...".

Be imaginative and unconventional where it helps, but never invent facts to make an idea more interesting. State uncertainty plainly.

When you have enough information, give a concrete recommendation. If one missing fact would materially change the answer, ask a single focused question instead of hedging across every branch.

Write in clean, concise Markdown. No filler, no flattery, no restating the question back.`

// Built on first use, not at import: the desktop shell loads the per-user .env
// after this module is imported, so a client constructed here would capture an
// empty environment and fail every call with "no authentication method".
let _client = null
function client() {
  if (_client) return _client
  // Identity-linked API keys must name the workspace they act in; ordinary keys
  // must not send the header at all, so it is only set when configured.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim()
  _client = new Anthropic(
    workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {},
  )
  return _client
}

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)

const send = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)

function openStream(params, signal, withFallbacks) {
  // Server-side refusal fallbacks: on a policy decline the API re-runs the same
  // request on a fallback model inside the same call, so a refusal does not
  // dead-end the conversation.
  if (withFallbacks) {
    return client().beta.messages.stream(
      { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' },
      { signal },
    )
  }
  return client().messages.stream(params, { signal })
}

async function chat(req, res, body) {
  if (!hasKey()) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    send(res, { type: 'error', kind: 'no_key', message: 'Ø needs a Claude connection.' })
    return res.end()
  }

  const model = MODELS.includes(body.model) ? body.model : DEFAULT_MODEL
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }))

  if (messages.length === 0) {
    res.writeHead(400, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: 'no messages' }))
  }

  const params = {
    model,
    max_tokens: 32000,
    // Adaptive thinking: Claude decides how much to reason per turn. Depth is
    // what this product sells, so it stays on.
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages,
  }

  const controller = new AbortController()
  // Abort on the RESPONSE closing, not the request. A request stream emits
  // 'close' as soon as its body has been read, which is before the answer has
  // even started - listening there cancels every call instantly.
  res.on('close', () => controller.abort())

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })

  let sentAny = false
  let useFallbacks = true

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const stream = openStream(params, controller.signal, useFallbacks)
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          sentAny = true
          send(res, { type: 'delta', text: event.delta.text })
        }
      }
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal') {
        send(res, {
          type: 'error',
          kind: 'refusal',
          message: final.stop_details?.explanation ?? 'That request was declined.',
        })
      }
      send(res, { type: 'done', model: final.model, stopReason: final.stop_reason })
      return res.end()
    } catch (err) {
      if (controller.signal.aborted) return res.end()

      // The fallbacks parameter is rejected on some routes; if it is refused
      // before any output, retry once on the plain streaming endpoint.
      if (err instanceof Anthropic.BadRequestError && useFallbacks && !sentAny) {
        console.warn('[svc] refusal fallbacks rejected, retrying without:', err.message)
        useFallbacks = false
        continue
      }

      let kind = 'api'
      let message = "I couldn't reach Claude."
      if (err instanceof Anthropic.AuthenticationError) {
        kind = 'auth'
        message = 'Ø needs a valid Claude connection.'
      } else if (err instanceof Anthropic.RateLimitError) {
        kind = 'rate_limit'
        message = 'Claude is temporarily limiting requests.'
      } else if (err instanceof Anthropic.APIConnectionError) {
        kind = 'offline'
        message = "I couldn't reach Claude."
      }
      console.error('[svc]', kind, err.message)
      send(res, { type: 'error', kind, message, detail: err.message })
      return res.end()
    }
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

/**
 * Serves the built renderer when a directory is supplied. Only used by the
 * desktop shell - in dev, Vite serves the renderer and proxies /api here.
 */
function serveStatic(dir, req, res) {
  const url = (req.url ?? '/').split('?')[0]
  // Contain the path inside dir: a request may not climb out with '..'.
  const rel = normalize(decodeURIComponent(url)).replace(/^[\/.]+/, '')
  let file = join(dir, rel)
  try {
    if (!file.startsWith(dir) || !statSync(file).isFile()) file = join(dir, 'index.html')
  } catch {
    file = join(dir, 'index.html')
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}

/**
 * Starts the service. `staticDir` makes it also serve the built renderer, so
 * the desktop shell can load everything from one loopback origin and relative
 * /api fetches keep working unchanged. `port: 0` picks a free port.
 */
export function startServer({ port = PORT, staticDir = null } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ connected: hasKey(), models: MODELS, default: DEFAULT_MODEL }))
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      let raw = ''
      req.on('data', (c) => {
        raw += c
        if (raw.length > 1e6) req.destroy()
      })
      req.on('end', () => {
        try {
          chat(req, res, JSON.parse(raw))
        } catch {
          res.writeHead(400).end()
        }
      })
      return
    }
    if (staticDir && req.method === 'GET') return serveStatic(staticDir, req, res)
    res.writeHead(404).end()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}
