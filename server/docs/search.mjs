// Ranked search over the local index, and the passage extraction that turns a
// hit into something short enough to show - and, only with approval, to send.
import { tokenize } from './index.mjs'

const K1 = 1.5
const B = 0.75

/**
 * How much a term found in the filename is worth, relative to the same term
 * found in the body.
 *
 * People ask for documents by their name - "the Odivelas deck", "the Almada
 * lists" - and a filename is a title its author chose, not incidental prose.
 * BM25 alone cannot see that: the name is indexed with the text, so in a
 * 200,000-character PDF those few terms are normalised away to nothing, while a
 * 2 KB byproduct that happens to repeat them scores enormously. The result is
 * that the file you named loses to files derived from it.
 *
 * High enough to decide a tie, not high enough to beat a document that is
 * genuinely about the subject.
 */
const TITLE_WEIGHT = 2.2
/** An additional multiple when the name matches every term, not merely some. */
const COMPLETE_TITLE = 1.6
/** The containing folders, worth less than the name but more than nothing. */
const PATH_WEIGHT = 0.5

/**
 * How strong a match must be, as a fraction of the best one, to be reordered
 * by date when the user asks for the most recent.
 *
 * "The latest contract" has to still mean a contract. Sorting everything that
 * ranked at all by date does not: the tail is thousands of documents that
 * matched one term once, and the newest of those wins outright.
 */
const RECENT_FLOOR = 0.4

/**
 * How far down the ranking the date reordering may reach.
 *
 * The floor above is a fraction of the best score, and on a large library the
 * scores are compressed enough that a great many weak matches clear it. This
 * bounds it by position as well. The two guard different failures - the floor
 * protects a handful of documents where there is no tail to speak of, the
 * pool protects tens of thousands where there is nothing but tail.
 */
const RECENT_POOL = 40

/** Name tokens per document, computed once per index rather than per query. */
function titleTokens(index, doc) {
  index._titles ??= new Map()
  let t = index._titles.get(doc.id)
  if (!t) {
    // The name and the folders that lead to it, kept apart: a term in the
    // filename is a stronger signal than the same term three directories up.
    const dir = doc.path.slice(0, doc.path.length - doc.name.length)
    t = { name: new Set(tokenize(doc.name)), dir: new Set(tokenize(dir)) }
    index._titles.set(doc.id, t)
  }
  return t
}

/**
 * BM25 over the body, plus a separate weighting of the filename.
 *
 * Rare terms count for more; long documents are not rewarded for length.
 * Asynchronous because each term's posting list is read from disk on demand -
 * the index is not held in memory.
 *
 * A document whose *name* matches can be ranked even when the body pass never
 * reached it, which is the point: asking for a file by its title has to find
 * that file, including scanned PDFs that hold no extractable text at all.
 */
async function score(index, terms) {
  const N = index.docs.size
  if (N === 0) return []
  let avgLen = 0
  for (const d of index.docs.values()) avgLen += d.terms ?? 1
  avgLen = avgLen / N || 1

  // Rarity per term, computed from the posting lists and reused by both passes
  // so a title match is weighted by the same scale as a body match.
  const idf = new Map()
  const lists = new Map()
  for (const term of terms) {
    const list = await index.lookup(term)
    lists.set(term, list)
    idf.set(term, Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5)))
  }

  const totals = new Map()
  for (const [term, list] of lists) {
    if (list.length === 0) continue
    const weight = idf.get(term)
    for (const [id, tf] of list) {
      const doc = index.docs.get(id)
      if (!doc) continue
      const len = doc.terms ?? 1
      const s = weight * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avgLen)))
      totals.set(id, (totals.get(id) ?? 0) + s)
    }
  }

  // The title pass walks every document rather than a posting list. That is
  // 38,000 set lookups on a real library - a few milliseconds - and it is the
  // only way a name-only match can be found at all.
  for (const doc of index.docs.values()) {
    const { name, dir } = titleTokens(index, doc)
    let bonus = 0
    let matched = 0
    for (const term of terms) {
      const weight = idf.get(term) ?? 0
      if (name.has(term)) {
        bonus += weight * TITLE_WEIGHT
        matched += 1
      } else if (dir.has(term)) {
        bonus += weight * PATH_WEIGHT
      }
    }
    if (bonus === 0) continue
    // Every term present in the name is a different claim from most of them:
    // "TDTH Corporate Deck" for "tdth deck" is the file, not a near miss.
    if (matched === terms.length) bonus *= COMPLETE_TITLE
    totals.set(doc.id, (totals.get(doc.id) ?? 0) + bonus)
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
export async function search(index, query, { limit = 8, passages = true, filter = null, recent = false } = {}) {
  const terms = [...new Set(tokenize(query))]
  const keep = filter ?? (() => true)

  // "The PDFs I touched last week" has no keywords in it at all. With a filter
  // to narrow by and an order to impose, that is a complete request - so an
  // empty query is answered by date rather than refused. Without either, it
  // still means nothing and returns nothing.
  let ranked
  if (terms.length === 0) {
    if (!filter && !recent) return { terms, results: [] }
    ranked = [...index.docs.values()]
      .filter(keep)
      .sort((a, b) => b.mtime - a.mtime)
      .map((d) => [d.id, d.mtime])
  } else {
    ranked = (await score(index, terms)).filter(([id]) => {
      const doc = index.docs.get(id)
      return doc ? keep(doc) : false
    })
    // "The most recent contract" has to still mean a contract. Sorting the
    // whole ranked list by date does not: the tail is thousands of documents
    // that matched a term once, and the newest of those wins outright. So the
    // date ordering is applied to the strongest matches only, and the rest are
    // left where relevance put them.
    if (recent) {
      // Which documents count as "genuinely matching" has to be judged against
      // this query's own scores - they are not comparable between queries - so
      // it is a fraction of the best score rather than a fixed number.
      const floor = (ranked[0]?.[1] ?? 0) * RECENT_FLOOR
      const pool = Math.max(RECENT_POOL, limit * 5)
      const strong = ([, sc], i) => i < pool && sc >= floor
      const head = ranked.filter(strong)
      head.sort((a, b) => (index.docs.get(b[0])?.mtime ?? 0) - (index.docs.get(a[0])?.mtime ?? 0))
      ranked = [...head, ...ranked.filter((r, i) => !strong(r, i))]
    }
  }

  // A pipeline that writes `upload_A_1759832554_<name>` beside `<name>` leaves
  // a library full of files that are the same document. Ranked together they
  // fill the whole result list with one answer, which is worse than ranking
  // badly. Same byte size and same extracted length is duplicate enough to
  // collapse; the best-scoring copy stands for the rest, and says how many.
  const seen = new Map()
  const results = []
  let scanned = 0
  for (const [id, s] of ranked) {
    // Keep reading past `limit` so the duplicate counts on the entries already
    // held are true, but not indefinitely - the tail is unranked noise.
    if (results.length >= limit && (scanned += 1) > limit * 8) break
    const doc = index.docs.get(id)
    if (!doc) continue

    const fingerprint = `${doc.size}:${doc.chars}:${doc.ext}`
    const first = seen.get(fingerprint)
    if (!first && results.length >= limit) continue
    if (first) {
      first.duplicates += 1
      // Prefer the shortest path as the one shown: the original is rarely the
      // copy with a timestamp bolted onto its name.
      if (doc.path.length < first.path.length) {
        first.path = doc.path
        first.name = doc.name
        first.id = id
      }
      continue
    }

    const entry = {
      duplicates: 0,
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
    seen.set(fingerprint, entry)
    results.push(entry)
  }
  return { terms, results }
}
