// The manifest surviving a bad moment.
//
// The manifest is the library: the roots the user chose and every document
// found under them. It was written in place, so a save cut short - by a crash,
// or by two saves overlapping - left a file that no longer parses. load() then
// caught the parse error and started as if this were a first run, which meant
// the folders and tens of thousands of documents were gone and the next save
// wrote that emptiness over the only copy. This happened on a real library.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises'

import { DocIndex } from '../server/docs/index.mjs'

const dir = join(tmpdir(), 'pi-test-manifest')

const fresh = async (name) => {
  const home = join(dir, name)
  await rm(home, { recursive: true, force: true })
  await mkdir(home, { recursive: true })
  return home
}

const seed = async (home) => {
  const index = await new DocIndex(home).load()
  index.roots = ['C:\Users\someone\Documents']
  index.docs.set('a', { id: 'a', name: 'One.md', path: 'p/One.md', ext: '.md', size: 1, mtime: 1 })
  index.docs.set('b', { id: 'b', name: 'Two.md', path: 'p/Two.md', ext: '.md', size: 1, mtime: 2 })
  await index.save()
  return index
}

test.after(() => rm(dir, { recursive: true, force: true }))

test('a truncated manifest does not read as a first run', async () => {
  const home = await fresh('truncated')
  await seed(home)

  // Exactly what was found on disk: a save that stopped partway.
  const file = join(home, 'manifest.json')
  const whole = await readFile(file, 'utf8')
  await writeFile(file, whole.slice(0, Math.floor(whole.length * 0.6)), 'utf8')

  const reopened = await new DocIndex(home).load()
  assert.deepEqual(reopened.roots, ['C:\Users\someone\Documents'], 'the chosen folders survive')
  assert.equal(reopened.docs.size, 2, 'the library survives')
})

test('a save leaves the file either whole or as it was', async () => {
  const home = await fresh('whole')
  const index = await seed(home)
  index.docs.set('c', { id: 'c', name: 'Three.md', path: 'p/Three.md', ext: '.md', size: 1, mtime: 3 })
  await index.save()

  const parsed = JSON.parse(await readFile(join(home, 'manifest.json'), 'utf8'))
  assert.equal(parsed.docs.length, 3)
  // And the version before it is still there to fall back to.
  const backup = JSON.parse(await readFile(join(home, 'manifest.json.bak'), 'utf8'))
  assert.equal(backup.docs.length, 2)
})

test('overlapping saves do not interleave into a broken file', async () => {
  const home = await fresh('concurrent')
  const index = await seed(home)

  // A crawl and the watcher both finishing a batch at the same moment.
  await Promise.all(
    Array.from({ length: 8 }, (_, i) => {
      index.docs.set(`x${i}`, { id: `x${i}`, name: `${i}.md`, path: `p/${i}.md`, ext: '.md', size: 1, mtime: i })
      return index.save()
    }),
  )

  const parsed = JSON.parse(await readFile(join(home, 'manifest.json'), 'utf8'))
  assert.equal(parsed.docs.length, 10, 'the last save wrote every document, whole')
})

test('a genuine first run is still a first run', async () => {
  const home = await fresh('empty')
  const index = await new DocIndex(home).load()
  assert.deepEqual(index.roots, [])
  assert.equal(index.docs.size, 0)
})
