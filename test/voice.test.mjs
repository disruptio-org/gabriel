// The custody guarantees of voice, as executable checks.
//
// Voice is the first thing in this app that sends something other than an
// approved document passage off the machine, so the promises around it are
// worth tests that fail loudly rather than a paragraph in a README: that a
// recording is only ever sent when there is a credential to send it with, that
// silence costs nothing, that the recording is not written anywhere, and that
// the key itself never becomes reachable from the renderer.
//
// Run with `npm test`. Nothing here contacts OpenAI - the outbound request is
// captured by a local server standing in for the API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startServer } from '../server/index.mjs'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Stands in for api.openai.com and records every request that reaches it, so a
 * test can assert that a call was made - or, more importantly, that it was not.
 */
async function stubOpenAI(handler) {
  const seen = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks) })
      handler(req, res)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    seen,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  }
}

/** Boots the real service on a free port, with whatever environment is set. */
async function withService(fn) {
  const { server, port } = await startServer({ port: 0 })
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    // The listener must go, or the test runner waits on it forever.
    await new Promise((r) => server.close(r))
  }
}

const post = (base, body, type = 'audio/webm') =>
  fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'content-type': type }, body })

/** Every file under a directory, with size and mtime, ignoring node_modules. */
function snapshot(dir, acc = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) snapshot(full, acc)
    else {
      const s = statSync(full)
      acc.set(full, `${s.size}:${s.mtimeMs}`)
    }
  }
  return acc
}

const KEY = 'sk-test-not-a-real-key'

test('with no OpenAI key, no recording is sent anywhere', async () => {
  const stub = await stubOpenAI((_req, res) => res.end('should never be reached'))
  process.env.OPENAI_BASE_URL = stub.url
  delete process.env.OPENAI_API_KEY

  await withService(async (base) => {
    const res = await post(base, Buffer.from('pretend this is opus'))
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.kind, 'no_key', 'a missing key must be its own answer')
  })

  await stub.close()
  assert.equal(stub.seen.length, 0, 'audio was sent despite there being no credential')
})

test('silence is refused locally, without spending a request', async () => {
  const stub = await stubOpenAI((_req, res) => res.end('transcript'))
  process.env.OPENAI_BASE_URL = stub.url
  process.env.OPENAI_API_KEY = KEY

  await withService(async (base) => {
    const body = await (await post(base, Buffer.alloc(0))).json()
    assert.equal(body.kind, 'empty', 'an empty recording must not become a request')
  })

  await stub.close()
  assert.equal(stub.seen.length, 0, 'an empty recording reached the network')
})

test('a transcript that is only punctuation is treated as silence', async () => {
  // Whisper-family models render a silent clip as a stray mark rather than as
  // nothing; pasting that into the composer would be worse than saying nothing.
  const stub = await stubOpenAI((_req, res) => res.end(' . '))
  process.env.OPENAI_BASE_URL = stub.url
  process.env.OPENAI_API_KEY = KEY

  await withService(async (base) => {
    const body = await (await post(base, Buffer.from('a real recording of silence'))).json()
    assert.equal(body.ok, false)
    assert.equal(body.kind, 'empty')
  })

  await stub.close()
})

test('the recording reaches OpenAI, and is written nowhere on this machine', async () => {
  const audio = Buffer.from('OggS-pretend-opus-payload-with-distinctive-bytes')
  const stub = await stubOpenAI((_req, res) => res.end('Thinking out loud.'))
  process.env.OPENAI_BASE_URL = stub.url
  process.env.OPENAI_API_KEY = KEY

  const before = snapshot(APP)

  await withService(async (base) => {
    const body = await (await post(base, audio)).json()
    assert.equal(body.ok, true)
    assert.equal(body.text, 'Thinking out loud.')
  })

  await stub.close()

  assert.equal(stub.seen.length, 1, 'the recording did not reach the transcriber')
  const sent = stub.seen[0]
  assert.ok(sent.url.endsWith('/audio/transcriptions'), `unexpected endpoint ${sent.url}`)
  assert.ok(sent.body.includes(audio), 'the audio was altered on the way out')
  assert.ok(sent.body.includes('gpt-4o-transcribe'), 'a different model was asked for')

  // Nothing appeared, changed or grew anywhere in the app directory. The
  // recording existed in memory for one request and nowhere else.
  const after = snapshot(APP)
  const added = [...after.keys()].filter((f) => !before.has(f))
  const changed = [...after.keys()].filter((f) => before.has(f) && before.get(f) !== after.get(f))
  assert.deepEqual(added, [], 'a voice turn created files')
  assert.deepEqual(changed, [], 'a voice turn modified files')
})

test('the OpenAI key is never reachable from the renderer', async () => {
  const stub = await stubOpenAI((_req, res) => res.end('a transcript'))
  process.env.OPENAI_BASE_URL = stub.url
  process.env.OPENAI_API_KEY = KEY

  await withService(async (base) => {
    // Health is what the renderer reads on every boot: it may name the key by
    // its last four characters and by nothing else.
    const health = await (await fetch(`${base}/api/health`)).text()
    assert.ok(!health.includes(KEY), 'the key is in /api/health')
    assert.ok(health.includes('•••• '), 'the hint is missing, so the UI cannot show which key')

    // And no other response may carry it either, including error paths.
    const ok = await (await post(base, Buffer.from('audio'))).text()
    assert.ok(!ok.includes(KEY), 'the key came back on a transcript')

    delete process.env.OPENAI_API_KEY
    const denied = await (await post(base, Buffer.from('audio'))).text()
    assert.ok(!denied.includes(KEY), 'the key came back on a refusal')
  })

  await stub.close()

  // It does travel to OpenAI, as a bearer token, and nowhere else.
  assert.ok(
    stub.seen.every((r) => r.auth === `Bearer ${KEY}`),
    'the credential did not authenticate the upload',
  )
})

test('an oversized recording is refused rather than uploaded', async () => {
  const stub = await stubOpenAI((_req, res) => res.end('should never be reached'))
  process.env.OPENAI_BASE_URL = stub.url
  process.env.OPENAI_API_KEY = KEY

  await withService(async (base) => {
    // Past the cap the bytes are dropped, not the socket, so the user gets a
    // sentence rather than a dead connection.
    const body = await (await post(base, Buffer.alloc(26 * 1024 * 1024))).json()
    assert.equal(body.kind, 'too_long')
  })

  await stub.close()
  assert.equal(stub.seen.length, 0, 'an oversized recording was uploaded anyway')
})

test('a turn carrying no attachments sends no document blocks', async () => {
  // The renderer guarantees hands-free never attaches anything; this is the
  // other half of that promise - that an empty attachment list really does
  // reach Claude as a bare question.
  let captured = null
  const capture = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      captured = JSON.parse(body)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    })
  })
  await new Promise((r) => capture.listen(0, '127.0.0.1', r))

  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${capture.address().port}`
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key'

  await withService(async (base) => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'Spoken, not typed.' }],
        attachments: [],
      }),
    })
    await res.text()
  })

  await new Promise((r) => capture.close(r))

  const sent = (captured?.messages ?? []).map((m) => m.content).join('\n\n')
  assert.ok(captured, 'no request reached the wire')
  assert.equal(sent, 'Spoken, not typed.', 'something was attached to a turn that attached nothing')
})
