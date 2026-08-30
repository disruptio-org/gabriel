// The term index lives on disk, not in memory. That is a real behaviour with a
// real failure mode - a binary search over a file that is not sorted, or an
// offset table that has drifted from the lines it points at, returns silently
// wrong results rather than crashing. So it is checked against the file itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { readFile, rm, stat } from 'node:fs/promises'

import { DocIndex, tokenize } from '../server/docs/index.mjs'
import { search } from '../server/docs/search.mjs'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = join(tmpdir(), 'pi-test-postings')
await rm(dir, { recursive: true, force: true })

const index = await new DocIndex(dir).load()
index.roots = [join(APP, 'server')]
await index.build()
assert.ok(index.docs.size >= 5, 'the test index needs documents')
await index.ensurePostings()

// The file is the reference: everything below must agree with it.
const lines = (await readFile(index.postingsFile, 'utf8')).split('\n').filter(Boolean)
const onDisk = new Map(lines.map((l) => JSON.parse(l)))

test('terms are written in sorted order', () => {
  const terms = [...onDisk.keys()]
  assert.deepEqual(terms, [...terms].sort(), 'postings.jsonl is not sorted')
  assert.equal(index.termCount, terms.length, 'the offset table has a different length')
})

test('the offset table points at the line it claims', async () => {
  const size = (await stat(index.offsetsFile)).size
  assert.equal(size, index.termCount * 8)
  // First, last, and a scatter in between - a drifting table shows up fast.
  const terms = [...onDisk.keys()]
  for (const i of [0, 1, terms.length >> 2, terms.length >> 1, terms.length - 1]) {
    const term = terms[i]
    assert.deepEqual(await index.lookup(term), onDisk.get(term), `wrong list for "${term}"`)
  }
})

test('every term is findable, and nothing else is', async () => {
  for (const term of onDisk.keys()) {
    const list = await index.lookup(term)
    assert.equal(list.length, onDisk.get(term).length, `binary search missed "${term}"`)
  }
  for (const missing of ['zzzznotaterminanyindex', 'aaaaaaaaaaaaaaaaaaaa', '00', 'zzzz']) {
    if (onDisk.has(missing)) continue
    assert.deepEqual(await index.lookup(missing), [], `invented a list for "${missing}"`)
  }
})

test('postings are not held in memory', async () => {
  // The whole point of the change. Nothing on the index may be a structure that
  // grows with the size of the term index except the offset table.
  assert.equal(index.offsets.length, index.termCount * 8)
  assert.ok(!('postings' in index) || index.postings == null, 'an in-memory postings map came back')
})

test('search still ranks the document that actually contains the words', async () => {
  const doc = [...index.docs.values()].find((d) => d.name === 'extract.mjs')
  assert.ok(doc, 'expected extract.mjs in the test index')
  const { results } = await search(index, 'faux bold glyph doubling', { limit: 5 })
  assert.ok(
    results.some((r) => r.id === doc.id),
    'the document holding those words did not rank',
  )
  assert.ok(results[0].passage.text.length > 0)
})

test('a rebuild replaces both files together', async () => {
  await index.buildPostings()
  const term = tokenize('extract')[0]
  assert.deepEqual(await index.lookup(term), onDisk.get(term))
  await index.closePostings()
})
