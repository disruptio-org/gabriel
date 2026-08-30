// Ranked search over the local index, and the passage extraction that turns a
// hit into something short enough to show - and, only with approval, to send.
import { tokenize } from './index.mjs'

const K1 = 1.5
const B = 0.75

/**
 * Standard BM25. Rare terms count for more; long documents are not rewarded for
 * length. Asynchronous because each term's posting list is read from disk on
 * demand - the index is not held in memory.
 */
async function score(index, terms) {
  const N = index.docs.size
  if (N === 0) return []
  let avgLen = 0
  for (const d of index.docs.values()) avgLen += d.terms ?? 1
  avgLen = avgLen / N || 1

  const totals = new Map()
  for (const term of terms) {
    const list = await index.lookup(term)
    if (list.length === 0) continue
    const idf = Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5))
    for (const [id, tf] of list) {
      const doc = index.docs.get(id)
      if (!doc) continue
      const len = doc.terms ?? 1
      const s = idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avgLen)))
      totals.set(id, (totals.get(id) ?? 0) + s)
    }
  }
  return [...totals].sort((a, b) => b[1] - a[1])
}

/**
 * Finds the densest window of query terms in the document and returns it with
 * a little context. This is exactly what the approval sheet shows and what
 * would be attached to a prompt, so it is deliberately bounded.
 */
export function bestPassage(text, terms, { window = 900 } = {}) {
  const want = new Set(terms)
  const hay = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

  // Positions of every query-term occurrence, in order.
  const hits = []
  const re = /[a-z0-9_]+/g
  let m
  while ((m = re.exec(hay)) !== null) {
    if (want.has(m[0])) hits.push(m.index)
  }
  if (hits.length === 0) return { text: text.slice(0, window).trim(), offset: 0, hits: 0 }

  // Slide over the hit positions: the best window is the one covering the most.
  let best = { start: hits[0], count: 0 }
  let lo = 0
  for (let hi = 0; hi < hits.length; hi++) {
    while (hits[hi] - hits[lo] > window) lo++
    const count = hi - lo + 1
    if (count > best.count) best = { start: hits[lo], count }
  }

  let start = Math.max(0, best.start - 120)
  let end = Math.min(text.length, start + window)
  // Snap to word boundaries so a passage never starts mid-word.
  if (start > 0) {
    const nl = text.lastIndexOf('\n', start)
    const sp = text.lastIndexOf(' ', start)
    start = Math.max(nl, sp, start - 40) + 1
  }
  if (end < text.length) {
    const sp = text.indexOf(' ', end)
    if (sp !== -1 && sp - end < 40) end = sp
  }
  return { text: text.slice(start, end).trim(), offset: start, hits: best.count }
}

/**
 * Searches the index. Returns one entry per document, each carrying the single
 * best passage - never the whole file. The caller decides whether any of it is
 * ever attached to a prompt.
 */
export async function search(index, query, { limit = 8, passages = true } = {}) {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0) return { terms, results: [] }

  const ranked = (await score(index, terms)).slice(0, limit)

  const results = []
  for (const [id, s] of ranked) {
    const doc = index.docs.get(id)
    if (!doc) continue
    const entry = {
      id,
      path: doc.path,
      name: doc.name,
      ext: doc.ext,
      size: doc.size,
      mtime: doc.mtime,
      chars: doc.chars,
      score: Number(s.toFixed(3)),
    }
    if (passages) {
      try {
        entry.passage = bestPassage(await index.readText(id), terms)
      } catch {
        entry.passage = null // the cached text went missing; the hit still stands
      }
    }
    results.push(entry)
  }
  return { terms, results }
}
