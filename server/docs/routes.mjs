// /api/docs/* - the local library.
//
// The service is the only thing that touches the disk; the renderer sees only
// what these handlers return. Two rules hold everywhere in this file:
//   1. A path is read only if it lies inside a configured root.
//   2. Nothing here sends anything anywhere. Document text reaches Claude only
//      when the user approves it in the sheet and the renderer passes it back
//      to /api/chat as an explicit attachment.
import { stat } from 'node:fs/promises'
import { DocIndex } from './index.mjs'
import { search, bestPassage } from './search.mjs'
import { tokenize } from './index.mjs'

let index = null
let building = null

export async function initDocs(dir, defaultRoots = []) {
  index = await new DocIndex(dir).load()
  if (index.roots.length === 0 && defaultRoots.length > 0) {
    index.roots = defaultRoots
    await index.save()
  }
  // An index written before the term index moved to disk has no offset table,
  // and rebuilding it takes about a minute on a large library. Do that now, in
  // the background, rather than silently under the user's first search.
  void index.ensurePostings().catch((err) => console.error('[docs] postings:', err.message))
  return index
}

export const docsReady = () => index !== null

const json = (res, code, payload) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** Kicks off a crawl in the background; progress is polled via /api/docs/status. */
function startBuild() {
  if (building) return false
  building = index
    .build()
    .catch((err) => console.error('[docs] index failed:', err.message))
    .finally(() => {
      building = null
    })
  return true
}

/** A single approved passage may not exceed this. Ten of them is already a lot of prompt. */
const MAX_PASSAGE = 4000
const MAX_ATTACHMENTS = 10

/**
 * Turns the renderer's references into the passages that will be sent.
 *
 * The renderer never supplies the text - only which document, and which slice
 * of it. The service reads that slice from the same cached extraction the
 * approval sheet was rendered from, so the user's "send this" applies to
 * exactly these bytes. A reference to a document that is not indexed, or that
 * has fallen outside the configured folders, resolves to nothing.
 */
export async function resolveAttachments(refs) {
  if (!index) return []
  const out = []
  for (const ref of refs.slice(0, MAX_ATTACHMENTS)) {
    const doc = index.docs.get(ref?.id)
    if (!doc || !index.contains(doc.path)) continue
    let text
    try {
      text = await index.readText(doc.id)
    } catch {
      continue
    }
    const offset = Math.max(0, Math.min(Number(ref.offset) || 0, text.length))
    const length = Math.max(0, Math.min(Number(ref.length) || MAX_PASSAGE, MAX_PASSAGE))
    const slice = text.slice(offset, offset + length).trim()
    if (slice) out.push({ id: doc.id, path: doc.path, name: doc.name, text: slice })
  }
  return out
}

/**
 * The search behind Ø's `find_documents` tool.
 *
 * Deliberately returns *no document text*. Rule 2 at the top of this file says
 * nothing here sends anything anywhere, and a tool that handed passages
 * straight to Claude would be the one thing that breaks it - content would
 * leave the machine because Ø decided to look, not because the user ticked
 * anything. So this answers "which documents are these" and stops there.
 * Reading one is a separate, approved act.
 *
 * Names and containing folders do go, because without them Ø cannot tell two
 * files apart or say anything useful about what it found.
 */
export async function findDocuments(query, { limit = 8 } = {}) {
  if (!index) return { ready: false, results: [] }
  const capped = Math.min(Math.max(Number(limit) || 8, 1), 15)
  const { terms, results } = await search(index, String(query ?? ''), {
    limit: capped,
    passages: false,
  })
  return {
    ready: true,
    terms,
    indexed: index.docs.size,
    results: results.map((r) => ({
      id: r.id,
      name: r.name,
      folder: r.path.slice(0, r.path.length - r.name.length).replace(/[\\/]$/, ''),
      ext: r.ext,
      // Bytes and epoch millis are not what a reader wants to reason about.
      size_kb: Math.max(1, Math.round(r.size / 1024)),
      modified: new Date(r.mtime).toISOString().slice(0, 10),
      copies: r.duplicates > 0 ? r.duplicates + 1 : undefined,
    })),
  }
}

export async function handleDocs(req, res, url, body) {
  if (!index) return json(res, 503, { error: 'index not ready' })
  const route = url.pathname.slice('/api/docs/'.length)

  if (req.method === 'GET' && route === 'status') {
    return json(res, 200, { ...index.status(), building: Boolean(building) })
  }

  if (req.method === 'POST' && route === 'reindex') {
    const started = startBuild()
    return json(res, 200, { started, ...index.status() })
  }

  if (req.method === 'POST' && route === 'cancel') {
    index.cancel()
    return json(res, 200, { ok: true })
  }

  if (req.method === 'POST' && route === 'roots') {
    const add = typeof body?.add === 'string' ? body.add.trim() : null
    const remove = typeof body?.remove === 'string' ? body.remove.trim() : null
    if (add) {
      try {
        if (!(await stat(add)).isDirectory()) throw new Error('not a directory')
      } catch {
        return json(res, 400, { error: 'That folder does not exist.' })
      }
      if (!index.roots.includes(add)) index.roots.push(add)
    }
    if (remove) index.roots = index.roots.filter((r) => r !== remove)
    await index.save()
    if (add) startBuild()
    return json(res, 200, { roots: index.roots })
  }

  if (req.method === 'GET' && route === 'search') {
    const q = url.searchParams.get('q') ?? ''
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 8) || 8, 25)
    return json(res, 200, await search(index, q, { limit }))
  }

  // The full extracted text of one document, for reading it inside the app.
  // Bounded, and only ever for a document that is actually in the index.
  if (req.method === 'GET' && route === 'text') {
    const id = url.searchParams.get('id') ?? ''
    const doc = index.docs.get(id)
    if (!doc) return json(res, 404, { error: 'not indexed' })
    if (!index.contains(doc.path)) return json(res, 403, { error: 'outside the configured folders' })
    const q = url.searchParams.get('q')
    const text = await index.readText(id)
    return json(res, 200, {
      ...doc,
      text: text.slice(0, 200_000),
      truncated: text.length > 200_000,
      passage: q ? bestPassage(text, [...new Set(tokenize(q))]) : null,
    })
  }

  return json(res, 404, { error: 'unknown docs route' })
}
