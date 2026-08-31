// Narrowing a search: folder, file type, date, and order.
//
// The filters exist because one blunt keyword search over 38,000 documents
// answers "where is my Almada contract" with whatever mentions Almada most
// often, which is rarely the contract. Each of these is a way for Ø to say
// what it already knows about the file it is looking for.
//
// The property worth protecting is that a filter only ever narrows. A filter
// the model got wrong, or wrote in a form the service did not expect, must
// leave the search as it was - never silently empty it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm, writeFile, utimes } from 'node:fs/promises'

import { DocIndex } from '../server/docs/index.mjs'
import { initDocs, stopDocs, findDocuments } from '../server/docs/routes.mjs'

const dir = join(tmpdir(), 'pi-test-filters')
const docs = join(dir, 'docs')
const decks = join(docs, 'Blue Gorilla')
const old = join(docs, 'Arquivo')

await rm(dir, { recursive: true, force: true })
await mkdir(decks, { recursive: true })
await mkdir(old, { recursive: true })

const day = (iso) => new Date(`${iso}T12:00:00Z`)

/** A file with a known name, folder, body and modification date. */
async function make(path, body, iso) {
  await writeFile(path, body)
  await utimes(path, day(iso), day(iso))
}

// Two decks in one folder, a spreadsheet elsewhere, and an old one - enough
// for each filter to have something it must exclude.
await make(join(decks, 'Commercial Deck.md'), '# Commercial deck\n\nProposta comercial para o cliente.', '2026-06-15')
await make(join(decks, 'Commercial Deck.csv'), 'linha,valor\ndeck comercial,1', '2026-06-20')
await make(join(docs, 'Orcamento Comercial.md'), '# Orcamento\n\nProposta comercial e deck de apoio.', '2026-07-01')
await make(join(old, 'Deck Antigo.md'), '# Deck antigo\n\nProposta comercial de 2019.', '2019-03-02')

const indexDir = join(dir, 'index')
const index = await new DocIndex(indexDir).load()
index.roots = [docs]
await index.build()
await index.ensurePostings()
await initDocs(indexDir, [docs])

const names = (r) => r.results.map((d) => d.name).sort()

test('a file-type filter excludes every other type', async () => {
  const all = await findDocuments('deck comercial', { limit: 10 })
  assert.ok(all.results.length > 1, 'the fixture found nothing to narrow')

  const csv = await findDocuments('deck comercial', { limit: 10, ext: ['csv'] })
  assert.deepEqual(names(csv), ['Commercial Deck.csv'])

  // Ø writes the extension both ways; both have to mean the same thing.
  const dotted = await findDocuments('deck comercial', { limit: 10, ext: ['.csv'] })
  assert.deepEqual(names(dotted), names(csv), 'a leading dot changed the result')
})

test('a folder filter scopes to a subtree without needing the full path', async () => {
  const scoped = await findDocuments('deck comercial', { limit: 10, folder: 'blue gorilla' })
  assert.deepEqual(names(scoped), ['Commercial Deck.csv', 'Commercial Deck.md'])
})

test('dates bound the results at both ends, and include the named day', async () => {
  const since = await findDocuments('deck comercial', { limit: 10, after: '2026-07-01' })
  assert.deepEqual(names(since), ['Orcamento Comercial.md'], 'the boundary day was excluded')

  const until = await findDocuments('deck comercial', { limit: 10, before: '2020-01-01' })
  assert.deepEqual(names(until), ['Deck Antigo.md'])
})

test('a filter alone is a search; nothing at all is not', async () => {
  // "The markdown I wrote most recently" carries no keywords, and is still a
  // complete request.
  const byDate = await findDocuments('', { limit: 10, ext: ['md'], recent: true })
  assert.deepEqual(
    byDate.results.map((d) => d.name),
    ['Orcamento Comercial.md', 'Commercial Deck.md', 'Deck Antigo.md'],
    'an unqueried, filtered search should come back newest first',
  )

  const nothing = await findDocuments('', { limit: 10 })
  assert.equal(nothing.results.length, 0, 'a search for nothing returned something')
})

test('ordering by date still respects what was asked for', async () => {
  // The .csv is the newest thing matching "comercial", but it is a row of a
  // spreadsheet, not a proposal. Recency reorders the good matches; it does
  // not promote a weak one over them.
  const r = await findDocuments('proposta comercial', { limit: 3, recent: true })
  assert.ok(
    r.results.every((d) => d.ext !== '.csv'),
    'a weak match won on date alone, which is what relevance is for',
  )
})

test('a filter the model got wrong narrows nothing rather than everything', async () => {
  const plain = await findDocuments('deck comercial', { limit: 10 })

  // A date it wrote as prose, and one that is not a date at all.
  for (const bad of ['last week', '2026-13-45', '']) {
    const r = await findDocuments('deck comercial', { limit: 10, after: bad })
    assert.deepEqual(names(r), names(plain), `after:"${bad}" changed the results`)
  }

  // An empty list of types means the user named no type.
  const noExt = await findDocuments('deck comercial', { limit: 10, ext: [] })
  assert.deepEqual(names(noExt), names(plain), 'an empty type list excluded everything')
})

test.after(async () => {
  // initDocs starts watching the fixture folder. Nothing else will stop it,
  // and a watched directory that is about to be deleted keeps the process up.
  await stopDocs()
  await rm(dir, { recursive: true, force: true })
})
