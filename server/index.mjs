// Personal Intelligence - local application service.
//
// This is the only process that reads the provider API keys (see
// providers.mjs). The renderer talks to it over loopback and receives model
// output as Server-Sent Events, so no credential is ever bundled into, or
// reachable from, browser code (§16).
import http from 'node:http'
import { readFileSync, createReadStream, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import {
  handleDocs,
  docsReady,
  resolveAttachments,
  initDocs,
  findDocuments,
} from './docs/routes.mjs'
import {
  PROVIDERS,
  PRIMARY,
  isProvider,
  hasKey,
  keyHint,
  setKeyEnv,
  providerHealth,
} from './providers.mjs'
import { transcribe, baseUrl, MAX_BYTES } from './voice.mjs'

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

/**
 * How many times Ø may search within a single turn.
 *
 * More than one because the first query is often the user's words rather than
 * the document's, and a second attempt with better terms is exactly what a
 * person would do. Bounded because each round is a full model call, and a
 * search that has not found it in four tries is not going to.
 */
const MAX_TOOL_ROUNDS = 4

/**
 * The library, as Ø can use it.
 *
 * It returns which documents exist and nothing about what they say. That is the
 * whole design: the user's approval is what turns a found document into a read
 * one, and a tool that returned text would take that decision away from them
 * without ever showing them a sheet.
 */
const FIND_DOCUMENTS = {
  name: 'find_documents',
  description: [
    "Search the user's own documents on this computer by keyword.",
    'Returns file names, folders, dates and sizes - never their contents.',
    'Use it whenever the user refers to a document of theirs, asks where',
    'something is, or asks what they have on a subject. Search with the words',
    'likely to be in the file name or the text; if nothing fits, try again with',
    'different terms before concluding it is not there. To read one, tell the',
    'user which you found and ask them to attach it - you cannot open it',
    'yourself.',
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Keywords to search for. Not a sentence.',
      },
      limit: {
        type: 'integer',
        description: 'How many documents to return, 1-15. Defaults to 8.',
      },
    },
    required: ['query'],
  },
}

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

You run inside a desktop app on the user's own machine, and that app can search their documents. It keeps a local index of the files on this computer. So the honest answer to "can you see my files" is yes, through the mechanisms below, with their approval - never "I have no access to your computer", which is true of the model in general but false of this app.

You have a find_documents tool. It searches that index and tells you which documents exist - names, folders, dates, sizes - and nothing whatsoever about what is inside them. Use it whenever the user refers to a document of theirs rather than guessing or asking them for the path; they have tens of thousands of files and do not remember where things are. Search the way the file is likely to be named as well as what it is likely to say, and try different terms before concluding something is not there.

What the tool returns is a list, not a reading. You have not seen the contents of anything it finds, and you must never write as though you have - do not summarise, quote, or characterise a document you have only found. Tell the user what you found and let them attach it; the next turn will carry the passages if they approve. Saying "I found three files that look relevant - attach the first and I can tell you what it says" is correct. Inventing what is in it is not.

When the turn carries <document> blocks, they are those approved passages. Ground your answer in them and name the file you are drawing on. If they do not contain the answer, say so plainly rather than inferring one - and never claim to have read a file you were not given.

The app can also listen. When the user presses the microphone it records audio on this machine and sends that recording to OpenAI to be turned into text, and the text is what reaches you. So if they ask where their voice goes, say so plainly: the recording does leave this machine, which is different from their documents - those are only ever sent as passages they ticked. The audio is held for the length of one request and discarded once the text comes back; it is never stored, and you never receive the audio itself, only text the user chose to send. Do not tell them their voice stays on their computer, because it does not.

When a question is about the user's own files and no <document> block arrived, do not conclude the files are unreachable. Search with the tool. If the search itself comes back empty, say that nothing matched and point at the cause: the terms may be wrong, or the library may not be indexed yet (Ctrl+D opens it, REINDEX builds it).

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

// Supplied by whoever starts the service: the desktop shell encrypts through
// the OS credential store, the standalone dev service writes .env. Called as
// persistKey(provider, key), with null to remove.
let persistKey = null

/** Whether the server currently running was given a library to search. */
let libraryConfigured = false

/**
 * Confirms a key is live by listing models - the cheapest authenticated call
 * either provider offers. Returns on success and throws otherwise, with
 * `rejected` set on the error: true when the credential itself was refused,
 * false when the provider could not be reached at all. Those two are different
 * problems for the user, so they get different HTTP statuses.
 */
async function verifyKey(provider, key) {
  if (provider === 'anthropic') {
    const probe = new Anthropic({ apiKey: key, maxRetries: 0 })
    try {
      await probe.models.list({ limit: 1 })
    } catch (err) {
      throw Object.assign(err, { rejected: err instanceof Anthropic.AuthenticationError })
    }
    return
  }

  // OpenAI is reached with plain fetch: it is used for one multipart upload
  // and one probe, which does not earn a second SDK in the bundle.
  let res
  try {
    res = await fetch(`${baseUrl()}/models?limit=1`, {
      headers: { authorization: `Bearer ${key}` },
    })
  } catch (err) {
    throw Object.assign(new Error(err.message), { rejected: false })
  }
  if (!res.ok) {
    throw Object.assign(new Error(`openai responded ${res.status}`), {
      rejected: res.status === 401 || res.status === 403,
    })
  }
}

/** Invalidates any cached client built on the provider's previous credential. */
function credentialChanged(provider) {
  if (provider === 'anthropic') _client = null
}

async function setKey(res, body) {
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  // Absent for callers written before there was more than one provider.
  const provider = body.provider ?? PRIMARY
  if (!isProvider(provider)) return json(400, { ok: false, error: 'Unknown provider.' })

  const spec = PROVIDERS[provider]
  const key = typeof body.key === 'string' ? body.key.trim() : ''
  if (!key.startsWith(spec.prefix)) return json(400, { ok: false, error: spec.rejection })

  try {
    await verifyKey(provider, key)
  } catch (err) {
    // Deliberately never echoes the key back, and never logs it.
    console.error(`[svc] ${provider} key check failed:`, err.rejected ? 'rejected' : err.message)
    return json(err.rejected ? 401 : 502, {
      ok: false,
      error: err.rejected
        ? `${spec.label} rejected that key.`
        : `Could not reach ${spec.label} to check that key.`,
    })
  }

  setKeyEnv(provider, key)
  credentialChanged(provider)

  try {
    if (persistKey) await persistKey(provider, key)
  } catch (err) {
    console.error('[svc] key stored for this session only:', err.message)
    return json(200, {
      ok: true,
      hint: keyHint(provider),
      warning: 'Saved for this session, but it could not be written to storage.',
    })
  }
  console.log(`[svc] ${provider} connection established`)
  return json(200, { ok: true, hint: keyHint(provider) })
}

async function clearKey(res, provider) {
  if (!isProvider(provider)) {
    res.writeHead(400, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: false, error: 'Unknown provider.' }))
  }
  setKeyEnv(provider, null)
  credentialChanged(provider)
  try {
    if (persistKey) await persistKey(provider, null)
  } catch {
    /* the in-memory key is gone either way */
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
}

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
  if (!hasKey(PRIMARY)) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    send(res, { type: 'error', kind: 'no_key', message: 'Ø needs a Claude connection.' })
    return res.end()
  }

  const model = MODELS.includes(body.model) ? body.model : DEFAULT_MODEL
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content }))

  // Document context. The renderer sends only references - document id, offset
  // and length - and the service slices the passage out of its own cache. So
  // what the user approved in the sheet and what is actually transmitted are
  // read from the same bytes; the renderer cannot substitute anything, and no
  // file leaves this machine except a passage the user ticked.
  let attached = []
  if (Array.isArray(body.attachments) && body.attachments.length > 0) {
    attached = await resolveAttachments(body.attachments)
    if (attached.length > 0 && messages.length > 0) {
      const last = messages[messages.length - 1]
      const blocks = attached.map((a) => `<document path="${a.path}">\n${a.text}\n</document>`)
      last.content = `${blocks.join('\n\n')}\n\n${last.content}`
    }
  }

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

  // Offered only when there is an index to search. Without this the tool would
  // be advertised and then fail, which teaches Ø that the library is broken
  // rather than that it is still being built.
  if (libraryConfigured && docsReady() && body.docs !== false) params.tools = [FIND_DOCUMENTS]

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
  let rounds = 0
  let retried = false

  // Two separate limits share this loop: `retried` guards the one-off retry
  // without fallbacks, `rounds` guards how many times Ø may search before it
  // has to answer with what it has.
  for (;;) {
    try {
      const stream = openStream(params, controller.signal, useFallbacks)
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          sentAny = true
          send(res, { type: 'delta', text: event.delta.text })
        }
      }
      const final = await stream.finalMessage()

      // Ø asked to look something up. Run the search here - the index never
      // leaves this process - hand the results back, and let it carry on.
      if (final.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
        rounds += 1
        const calls = final.content.filter(
          (b) => b.type === 'tool_use' && b.name === FIND_DOCUMENTS.name,
        )
        // Thinking and tool_use blocks both have to go back verbatim.
        params.messages.push({ role: 'assistant', content: final.content })
        const outcomes = []
        for (const call of calls) {
          const query = String(call.input?.query ?? '')
          send(res, { type: 'searching', query })
          const found = await findDocuments(query, { limit: call.input?.limit })
          // The renderer gets the same results Ø does, so the user can act on
          // what was found rather than only read about it.
          send(res, { type: 'results', query, results: found.results })
          outcomes.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify(found),
          })
        }
        params.messages.push({ role: 'user', content: outcomes })
        continue
      }

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
      if (err instanceof Anthropic.BadRequestError && useFallbacks && !retried && !sentAny) {
        console.warn('[svc] refusal fallbacks rejected, retrying without:', err.message)
        useFallbacks = false
        retried = true
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
export async function startServer({
  port = PORT,
  staticDir = null,
  persist = null,
  docsDir = null,
  docsRoots = [],
} = {}) {
  persistKey = persist
  // The library is optional: without a directory to keep it in, /api/docs/*
  // simply answers 503 and the rest of the app is unaffected.
  //
  // Recorded here as well as in routes.mjs because that module holds its index
  // in a module-level variable: a server started without a library would
  // otherwise still offer the search tool, backed by an index some earlier
  // server in the same process happened to load. One server per process is the
  // only case that ships, but a service that behaves according to its own
  // configuration rather than the process's history is worth the one line.
  libraryConfigured = Boolean(docsDir)
  if (docsDir) await initDocs(docsDir, docsRoots)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (req.method === 'GET' && url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({
          // One entry per provider. Chat is gated on the primary one only:
          // a missing OpenAI key disables voice and nothing else.
          providers: providerHealth(),
          models: MODELS,
          default: DEFAULT_MODEL,
        }),
      )
    }
    if (req.method === 'DELETE' && url.pathname === '/api/key') {
      return void clearKey(res, url.searchParams.get('provider') ?? PRIMARY)
    }

    const isDocs = url.pathname.startsWith('/api/docs/')
    if (isDocs && req.method === 'GET') {
      if (!docsReady()) return void res.writeHead(503).end()
      return void handleDocs(req, res, url, null)
    }

    // Audio arrives as raw bytes rather than JSON, so it collects into buffers
    // instead of a string - and is handed straight to the transcriber without
    // ever reaching the filesystem.
    if (req.method === 'POST' && url.pathname === '/api/transcribe') {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        // Past the cap the bytes are dropped rather than the socket, so the
        // user gets a sentence explaining why instead of a dead connection.
        if (size <= MAX_BYTES) chunks.push(c)
      })
      req.on('end', () => {
        const audio = size > MAX_BYTES ? Buffer.alloc(MAX_BYTES + 1) : Buffer.concat(chunks)
        const type = req.headers['content-type'] ?? 'audio/webm'
        void transcribe(audio, type).then((result) => {
          // Always 200: every outcome here is a result the renderer renders,
          // not a transport failure. Chat's SSE errors follow the same rule.
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(result))
        })
      })
      return
    }

    if (req.method === 'POST' && (url.pathname === '/api/chat' || url.pathname === '/api/key' || isDocs)) {
      let raw = ''
      req.on('data', (c) => {
        raw += c
        // Attachments make a chat body legitimately large; the cap is a
        // runaway guard, not a feature limit.
        if (raw.length > 8e6) req.destroy()
      })
      req.on('end', () => {
        try {
          const parsed = JSON.parse(raw)
          if (isDocs) void handleDocs(req, res, url, parsed)
          else if (url.pathname === '/api/key') void setKey(res, parsed)
          else void chat(req, res, parsed)
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
