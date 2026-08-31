// What the ranker owes the person searching.
//
// A library of 38,000 files is where retrieval quality stops being academic:
// the document you asked for is definitely in there, and a ranker that puts it
// eleventh has lost it as surely as if it were never indexed. The two rules
// below are the ones that failed on a real library, so they are pinned here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm, writeFile } from 'node:fs/promises'

import { DocIndex } from '../server/docs/index.mjs'
import { search } from '../server/docs/search.mjs'

const dir = join(tmpdir(), 'pi-test-ranking')
const docs = join(dir, 'docs')
await rm(dir, { recursive: true, force: true })
await mkdir(docs, { recursive: true })

// The shape that broke it: one document *named* for the subject, and a pile of
// derived byproducts that merely mention it - many times, in far less text.
await writeFile(
  join(docs, 'Odivelas Assembleia Municipal.md'),
  // Deliberately long and only glancingly about the subject, the way a real
  // report is: the name is the strongest thing it has to say about itself.
  `# Relatorio\n\n${'Texto corrido sobre o processo eleitoral e os seus prazos. '.repeat(400)}`,
)
for (let i = 0; i < 6; i++) {
  await writeFile(
    join(docs, `resultado_final_${i}.csv`),
    `nome,concelho\n${'x,odivelas assembleia municipal\n'.repeat(30)}`,
  )
}

// Three byte-identical copies of one file, as a pipeline that timestamps its
// uploads leaves behind.
for (const name of ['Contrato.md', 'upload_A_1759832554_Contrato.md', 'upload_A_1759872321_Contrato.md']) {
  await writeFile(join(docs, name), `# Contrato\n\n${'clausula de rescisao antecipada. '.repeat(50)}`)
}

const index = await new DocIndex(dir).load()
index.roots = [docs]
await index.build()
await index.ensurePostings()

test('a document named for the subject outranks byproducts that merely mention it', async () => {
  const { results } = await search(index, 'odivelas assembleia municipal', {
    limit: 5,
    passages: false,
  })
  assert.ok(results.length > 0, 'nothing matched at all')
  assert.equal(
    results[0].name,
    'Odivelas Assembleia Municipal.md',
    `the named document ranked below its own byproducts: ${results.map((r) => r.name).join(', ')}`,
  )
})

test('a title match is found even when the body never mentions the terms', async () => {
  // The scanned-PDF case in miniature: the name is all there is to go on. This
  // holds because the filename is tokenised into the postings alongside the
  // text, not because of the title weighting - it passes with that weight set
  // to zero. Pinned anyway: it is the property that makes a library of
  // photographed pages searchable at all, and it would be easy to lose while
  // changing how documents are indexed.
  await writeFile(join(docs, 'Balancete Trimestral.md'), 'Sem texto util para indexar aqui.')
  const fresh = await new DocIndex(join(dir, 'again')).load()
  fresh.roots = [docs]
  await fresh.build()
  await fresh.ensurePostings()

  const { results } = await search(fresh, 'balancete trimestral', { limit: 5, passages: false })
  assert.equal(results[0]?.name, 'Balancete Trimestral.md', 'a name-only match was never ranked')
})

test('identical copies collapse into one result that says how many', async () => {
  const { results } = await search(index, 'clausula rescisao antecipada', {
    limit: 5,
    passages: false,
  })
  const contracts = results.filter((r) => r.name.endsWith('Contrato.md'))
  assert.equal(contracts.length, 1, 'the same document was listed more than once')
  assert.equal(contracts[0].duplicates, 2, 'the collapsed copies were not counted')
  // The copy shown is the one whose name a person would recognise.
  assert.equal(contracts[0].name, 'Contrato.md', 'a timestamped copy stood in for the original')
})

test.after(async () => {
  await index.close?.()
  await rm(dir, { recursive: true, force: true })
})
