// The index against a disk that keeps changing.
//
// A library that is only correct at the moment you last pressed REINDEX is
// wrong in exactly the case the user is most sure of: the file they saved a
// minute ago. These tests write files after the index is built and assert
// that searching finds what is on the disk now, not what was there then.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm, writeFile, rename } from 'node:fs/promises'

import { DocIndex } from '../server/docs/index.mjs'
import { Watcher } from '../server/docs/watch.mjs'
import { search } from '../server/docs/search.mjs'

const dir = join(tmpdir(), 'pi-test-live')
const docs = join(dir, 'docs')

await rm(dir, { recursive: true, force: true })
await mkdir(docs, { recursive: true })
await writeFile(join(docs, 'Existing.md'), 'A document that was here before anything changed.')

const index = await new DocIndex(join(dir, 'index')).load()
index.roots = [docs]
await index.build()
await index.ensurePostings()

const watcher = new Watcher(index).start()

/** Waits for the watcher to settle, or gives up. Events are not instant. */
async function settled(predicate, ms = 12_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await predicate()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

const found = async (q) => (await search(index, q, { limit: 10, passages: false })).results

test('a file written after the index was built is findable', async () => {
  const before = await found('quilombola')
  assert.equal(before.length, 0, 'the fixture word was already in the index')

  await writeFile(
    join(docs, 'Relatorio Quilombola.md'),
    '# Relatorio\n\nO levantamento quilombola do trimestre, com anexos.',
  )

  // By name, and by a word that appears only in the body - the second is the
  // harder half, because the term index on disk knows nothing about this file.
  assert.ok(await settled(async () => (await found('quilombola')).length > 0), 'never appeared')
  const byBody = await found('levantamento trimestre')
  assert.ok(
    byBody.some((d) => d.name === 'Relatorio Quilombola.md'),
    'found by name but not by its contents - the overlay is not being searched',
  )
})

test('editing a file changes what it matches', async () => {
  const path = join(docs, 'Existing.md')
  await writeFile(path, 'Rewritten entirely, and now about hidroponia.')

  assert.ok(await settled(async () => (await found('hidroponia')).length > 0), 'the edit never landed')
  // The old text must stop matching, or the index accumulates ghosts of every
  // version a file ever had.
  const stale = await found('before anything changed')
  assert.ok(
    !stale.some((d) => d.name === 'Existing.md'),
    'the previous contents still match, so the document is indexed twice over',
  )
})

test('a deleted file stops being offered', async () => {
  await rm(join(docs, 'Relatorio Quilombola.md'))
  assert.ok(
    await settled(async () => (await found('quilombola')).length === 0),
    'a deleted document is still in the results, where it would open nothing',
  )
})

test('a renamed file is found under its new name and not its old one', async () => {
  await writeFile(join(docs, 'Antigo.md'), 'Documento sobre apicultura urbana.')
  assert.ok(await settled(async () => (await found('apicultura')).length > 0), 'never indexed')

  await rename(join(docs, 'Antigo.md'), join(docs, 'Novo.md'))
  assert.ok(
    await settled(async () => {
      const r = await found('apicultura')
      return r.length === 1 && r[0].name === 'Novo.md'
    }),
    'a rename should leave exactly one document, under the new name',
  )
})

test('what the crawl refuses, saving a file cannot smuggle in', async () => {
  // The watcher sees every write under the root, including ones the crawl
  // would never have reached. If it indexed them, the skip rules would be
  // enforced only on the slow path - and a .env in a watched folder would
  // become one approval click from leaving the machine.
  const modules = join(docs, 'node_modules')
  await mkdir(modules, { recursive: true })
  await writeFile(join(modules, 'notes.md'), 'Conteudo dentro de node_modules com ornitorrinco.')
  await writeFile(join(docs, '.env'), 'API_KEY=ornitorrinco-secreto')

  await new Promise((r) => setTimeout(r, 4000))
  const hits = await found('ornitorrinco')
  assert.equal(hits.length, 0, `indexed something it should not have: ${hits.map((h) => h.name)}`)
})

test.after(async () => {
  await watcher.stop()
  await rm(dir, { recursive: true, force: true })
})
