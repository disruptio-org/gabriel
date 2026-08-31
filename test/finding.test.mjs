// Ø's document search, and the line it must not cross.
//
// The tool exists so Ø can find a file among tens of thousands without being
// told where it is. It deliberately cannot read one: that is what the approval
// sheet is for. The risk in a tool-use loop is that the boundary erodes
// quietly - a passage added to the tool result "for context", a cached
// extraction returned alongside the name - and nobody notices, because the
// feature keeps working. So the boundary is asserted, not just intended.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdir, rm, writeFile } from 'node:fs/promises'

import { startServer } from '../server/index.mjs'
import { documentPath, initDocs } from '../server/docs/routes.mjs'
import { DocIndex } from '../server/docs/index.mjs'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = join(tmpdir(), 'pi-test-finding')
const docs = join(dir, 'docs')

await rm(dir, { recursive: true, force: true })
await mkdir(docs, { recursive: true })

// A distinctive body, so any leak of contents into the tool result is
// unmistakable rather than a judgement call.
const SECRET_SENTENCE = 'A margem bruta consolidada foi de 41,7 por cento no trimestre.'
await writeFile(
  join(docs, 'Balancete Trimestral 2025.md'),
  `# Balancete\n\n${SECRET_SENTENCE}\n\n${'Linha de detalhe contabilistico. '.repeat(80)}`,
)
await writeFile(join(docs, 'Notas Soltas.md'), 'Um documento sem relacao com contabilidade.')

const indexDir = join(dir, 'index')
const index = await new DocIndex(indexDir).load()
index.roots = [docs]
await index.build()
await index.ensurePostings()

/**
 * Stands in for api.anthropic.com for the whole file, replying from a queue of
 * scripted SSE responses and recording every request body.
 *
 * One stub, not one per test, because the service builds its Anthropic client
 * once and caches it - a second stub on a second port would never be contacted,
 * and the tests that depended on it would fail or, worse, pass vacuously
 * against a request that was never made.
 */
const queue = []
const seen = []
const upstream = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(queue.shift() ?? answers('nothing scripted'))
  })
})
await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstream.address().port}`
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key'

/** An SSE message that asks to run find_documents, as the API would send it. */
const wantsSearch = (query) =>
  [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"claude-opus-5","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"find_documents","input":{}}}',
    '',
    'event: content_block_delta',
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(
      JSON.stringify({ query }),
    )}}}`,
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":2}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
    '',
  ].join('\n')

/** An SSE message that just answers. */
const answers = (text) =>
  [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"m2","type":"message","role":"assistant","model":"claude-opus-5","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}`,
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
    '',
  ].join('\n')

/** Runs one turn against the shared stub and returns what crossed the wire. */
async function ask(question, { replies, docsDir = indexDir } = {}) {
  const from = seen.length
  queue.push(...replies)
  const { server, port } = await startServer(
    docsDir ? { port: 0, docsDir, docsRoots: [docs] } : { port: 0 },
  )
  const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-5', messages: [{ role: 'user', content: question }] }),
  })
  const sse = await res.text()
  await new Promise((r) => server.close(r))
  queue.length = 0
  return { sse, requests: seen.slice(from) }
}

const SEARCH_THEN_ANSWER = () => [
  wantsSearch('balancete trimestral'),
  answers('I found one file.'),
]

// One turn, asserted from two angles: that it works, and that it does not
// overreach. Run once because the second assertion is about the same wire.
const turn = await ask('Where is my quarterly balance sheet?', { replies: SEARCH_THEN_ANSWER() })

test('Ø can search the library, and the search runs on this machine', () => {
  const { sse, requests } = turn

  assert.equal(requests.length, 2, 'the tool result was never sent back for an answer')
  assert.ok(requests[0].tools?.some((t) => t.name === 'find_documents'), 'the tool was not offered')

  // The renderer is told what was searched and what came back, so it can put
  // the results in front of the user rather than leaving them inside the answer.
  assert.match(sse, /"type":"searching"/, 'no search was announced to the renderer')
  assert.match(sse, /"type":"results"/, 'the results never reached the renderer')
  assert.match(sse, /Balancete Trimestral 2025\.md/, 'the document was not found')
})

test('the tool result names documents and reveals nothing of their contents', () => {
  // The second request carries the tool result. Everything the service told
  // Claude about the library is in here.
  const wire = JSON.stringify(turn.requests[1])
  assert.match(wire, /Balancete Trimestral 2025\.md/, 'the name should be there - it is the point')
  assert.ok(
    !wire.includes(SECRET_SENTENCE),
    'document text reached Claude through the tool, without the user approving anything',
  )
  assert.ok(
    !wire.includes('Linha de detalhe contabilistico'),
    'a passage leaked into the tool result',
  )
})

test('no tool is offered when the library is not indexed', async () => {
  // Started without docsDir: there is no index at all.
  const { requests } = await ask('find my notes', {
    replies: [answers('No library here.')],
    docsDir: null,
  })

  assert.equal(requests.length, 1, 'the request never reached the wire, so this proves nothing')
  assert.ok(
    !requests[0].tools,
    'a search tool was advertised with nothing behind it, which teaches Ø the library is broken',
  )
})

// The desktop shell can launch a document in another program. That capability
// is worth exactly one check: that the renderer cannot aim it. It passes an id,
// and an id that is not in the index resolves to nothing at all - so the set of
// launchable files is the set the user chose to index, and no string the
// renderer invents can widen it.
test('only indexed documents resolve to a path the shell may open', async () => {
  await initDocs(indexDir, [docs])
  const [known] = [...(await searchIds())]
  assert.ok(known, 'nothing was indexed, so this proves nothing')
  assert.equal(documentPath(known), join(docs, 'Balancete Trimestral 2025.md'))

  for (const forged of ['', 'not-an-id', join(docs, '..', '..', 'secrets.txt'), 'C:\Windows\notepad.exe']) {
    assert.equal(documentPath(forged), null, `a forged id resolved to a path: ${forged}`)
  }
})

/** The ids of every indexed document, read back from the index on disk. */
async function searchIds() {
  const fresh = await new DocIndex(indexDir).load()
  return [...fresh.docs.values()]
    .filter((d) => d.name === 'Balancete Trimestral 2025.md')
    .map((d) => d.id)
}

test.after(async () => {
  await new Promise((r) => upstream.close(r))
  await rm(dir, { recursive: true, force: true })
})
