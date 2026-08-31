// The local document index.
//
// Everything here reads the disk and writes to this machine's own app data.
// There is no network call in this file, and no document text is ever handed
// to the model without the user approving it first (see /api/docs/search and
// the approval sheet in the renderer).
import { readdir, stat, mkdir, readFile, writeFile, rm, rename, open } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { join, extname, basename, sep } from 'node:path'
import { extractText, SUPPORTED } from './extract.mjs'

// Directories that are never worth indexing: machine-generated, enormous, or
// not the user's documents at all.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'appdata', '$recycle.bin', 'windows',
  'program files', 'program files (x86)', 'programdata', 'dist', 'build',
  'out', 'release', '.next', '.nuxt', '.cache', '.turbo', '.gradle', '.venv',
  'venv', 'env', '__pycache__', 'target', 'vendor', 'bower_components',
  'system volume information', '.vscode', '.idea', 'obj', 'bin',
  // Generated caches. Crawling one real profile turned up ~50,000 JSON files
  // under folders like artifacts/cache/prod_pages - machine output that would
  // bury the user's actual documents in every search result.
  'cache', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.parcel-cache',
  'coverage', 'site-packages', '.terraform', '.tox', '.ipynb_checkpoints',
])

/**
 * Files that must never enter the index, because the index exists to be shown
 * to a model. Indexing someone's whole profile would otherwise sweep up their
 * private keys - including this app's own Claude key - and put them one
 * approval click away from leaving the machine.
 */
const SECRET_PATTERNS = [
  /^\.env($|\.)/i, /^\.npmrc$/i, /^\.netrc$/i, /^\.pgpass$/i, /^\.htpasswd$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i, /^credentials?($|[._-])/i, /^secrets?($|[._-])/i,
  /\.(pem|key|pfx|p12|jks|keystore|kdbx|ppk|asc|gpg|crt|cer)$/i,
  /(^|[._-])(secret|token|password|apikey|api_key)s?([._-]|$)/i,
]

const MAX_FILE_BYTES = 25 * 1024 * 1024

/** Thrown when a file parsed cleanly but holds no text - typically a scan. */
export class EmptyDocument extends Error {
  constructor() {
    super('no text')
    this.name = 'EmptyDocument'
  }
}

export const isSecretName = (name) => SECRET_PATTERNS.some((re) => re.test(name))

/** Whether a file's own name admits it to the index, ignoring where it sits. */
export const indexable = (name) =>
  SUPPORTED.has(extname(name).toLowerCase()) && !isSecretName(name)

/**
 * Whether a crawl of `root` would have reached this path.
 *
 * The walk decides this as it descends, one directory at a time. A watcher is
 * handed a finished path instead, and has to ask the same question of all of
 * it at once - so the rules live here, in one place, rather than being written
 * twice and drifting apart.
 *
 * Only the segments *below the root* are judged, because those are the only
 * ones the walk ever sees. The root itself was chosen by the user and is not
 * up for reconsideration: a library kept in a folder that happens to be called
 * `bin`, or under AppData, is still their library.
 */
export function crawlable(path, root) {
  if (!indexable(basename(path))) return false
  const rel = path.slice(root.length)
  const parts = rel.split(/[\\/]+/).filter(Boolean).slice(0, -1)
  return !parts.some((part) => part.startsWith('.') || SKIP_DIRS.has(part.toLowerCase()))
}

/** Accent-folded lowercase words. "Évora" and "evora" must be the same term. */
export function tokenize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && t.length < 40)
}

export const idFor = (path) => createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)

/**
 * On-disk layout, all under the app's own user-data directory:
 *   index/manifest.json   roots, settings, one record per indexed document
 *   index/postings.jsonl  term -> doc frequencies, one line per term, sorted
 *   index/postings.off    byte offset of each of those lines, for seeking
 *   index/text/<id>.txt   extracted text, so a passage can be shown without
 *                         re-parsing a 200-page PDF
 */
export class DocIndex {
  constructor(dir) {
    this.dir = dir
    this.textDir = join(dir, 'text')
    this.manifestFile = join(dir, 'manifest.json')
    this.postingsFile = join(dir, 'postings.jsonl')
    this.offsetsFile = join(dir, 'postings.off')

    this.roots = []
    this.docs = new Map() // id -> { id, path, name, ext, size, mtime, chars, indexedAt }
    // Files that parsed but held no text. Remembered so a folder of 14,000
    // scanned PDFs is not re-parsed from scratch on every single crawl - each
    // one costs a full pdf.js pass to learn the same nothing.
    this.empties = new Map() // id -> { size, mtime }
    // The term index is never held in memory. `offsets` is the one resident
    // part - eight bytes per distinct term, a few megabytes at any real size.
    this.fd = null
    this.offsets = null
    this.postingsBytes = 0
    // Documents indexed since the term index on disk was last written, and
    // their term counts. See #overlay below.
    this.fresh = new Map() // term -> Map(docId -> tf)
    this.freshDocs = new Set()
    this.progress = {
      state: 'idle',
      scanned: 0,
      indexed: 0,
      failed: 0,
      current: null,
    }
    this.dirty = false
    this.cancelled = false
  }

  async load() {
    await mkdir(this.textDir, { recursive: true })
    // The previous manifest is tried first, then the backup. A manifest that
    // exists but does not parse must not be treated as a first run: that would
    // silently discard a library of tens of thousands of documents and the
    // folders the user chose, and the next save would write the emptiness back
    // over the only copy.
    for (const file of [this.manifestFile, `${this.manifestFile}.bak`]) {
      let raw
      try {
        raw = await readFile(file, 'utf8')
      } catch {
        continue // genuinely absent
      }
      try {
        const m = JSON.parse(raw)
        this.roots = m.roots ?? []
        for (const d of m.docs ?? []) this.docs.set(d.id, d)
        for (const [id, meta] of m.empties ?? []) this.empties.set(id, meta)
        return this
      } catch (err) {
        console.error('[docs] unreadable manifest', file, '-', err.message)
      }
    }
    return this
  }

  /**
   * Writes the manifest.
   *
   * Through a temporary file and a rename, because the previous version wrote
   * over the live one in place: a crash, or the watcher and a crawl saving at
   * the same moment, left a half-written file that parses as nothing. Rename is
   * atomic within a volume, so the manifest on disk is always one whole save or
   * the one before it. The previous good copy is kept as .bak.
   *
   * Saves are also serialised. Two overlapping writes to one path interleave
   * their chunks, which is how a truncated manifest happens without any crash.
   */
  async save() {
    this.saving = Promise.resolve(this.saving).catch(() => {}).then(() => this.#save())
    return this.saving
  }

  async #save() {
    const payload = {
      version: 1,
      roots: this.roots,
      docs: [...this.docs.values()],
      empties: [...this.empties],
    }
    const tmp = `${this.manifestFile}.tmp`
    const bak = `${this.manifestFile}.bak`
    const json = JSON.stringify(payload)
    await writeFile(tmp, json, 'utf8')
    try {
      await rename(this.manifestFile, bak)
    } catch {
      // No previous version to demote - the first save of a new library. Write
      // the backup outright rather than leaving this one save with no second
      // copy, which is the state a first crawl spends its whole length in.
      await writeFile(bak, json, 'utf8')
    }
    await rename(tmp, this.manifestFile)
  }

  status() {
    return {
      roots: this.roots,
      documents: this.docs.size,
      ...this.progress,
      // The standing count, not this crawl's tally: once a scan is remembered
      // it is skipped on later crawls, and reporting 0 would read as if the
      // library had changed when nothing did.
      empty: this.empties.size,
    }
  }

  // ---- crawling -----------------------------------------------------------

  /** Walks a root, yielding candidate files. Symlinks are not followed. */
  async *walk(dir, depth = 0) {
    if (depth > 24 || this.cancelled) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory - permissions, or it vanished mid-walk
    }
    for (const e of entries) {
      if (this.cancelled) return
      const full = join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue
        yield* this.walk(full, depth + 1)
      } else if (e.isFile()) {
        if (!indexable(e.name)) continue
        yield full
      }
    }
  }

  /** True when the file is absent from the index or has changed since. */
  needsIndex(path, st) {
    const id = idFor(path)
    const known = this.docs.get(id) ?? this.empties.get(id)
    return !known || known.size !== st.size || known.mtime !== st.mtimeMs
  }

  async indexFile(path, st, { live = false } = {}) {
    const id = idFor(path)
    const text = await extractText(path)
    // A PDF that is a photograph of a page has no text layer at all. That is
    // not a failure to read the file - it is a file with nothing to read, and
    // counting it as an error makes the index look broken when it is not.
    if (text === null || text.trim().length === 0) throw new EmptyDocument()
    await writeFile(join(this.textDir, `${id}.txt`), text, 'utf8')
    this.docs.set(id, {
      id,
      path,
      name: basename(path),
      ext: extname(path).toLowerCase(),
      size: st.size,
      mtime: st.mtimeMs,
      chars: text.length,
      indexedAt: Date.now(),
    })
    this.dirty = true
    if (live) this.#remember(id, text)
    return id
  }

  // ---- the overlay --------------------------------------------------------
  //
  // postings.jsonl is one sorted line per term over the whole library, and the
  // offset table beside it is only meaningful for that exact file. Adding a
  // single document means writing all 298MB again - a minute of disk on a real
  // library, for one saved file. Doing that per change is not an option, and
  // waiting for the next full rebuild would mean a file you just wrote is not
  // searchable by its contents for hours.
  //
  // So freshly indexed documents keep their term counts in memory, and lookup()
  // answers from both: the disk list with those documents removed, plus what is
  // held here. The result is indistinguishable from a rebuilt index, and the
  // memory cost is bounded by how many files change between rebuilds rather
  // than by the size of the library.

  /** Holds one document's term frequencies in memory until the next rebuild. */
  #remember(id, text) {
    this.#forgetFresh(id)
    const counts = new Map()
    for (const term of tokenize(text)) counts.set(term, (counts.get(term) ?? 0) + 1)
    for (const [term, tf] of counts) {
      let byDoc = this.fresh.get(term)
      if (!byDoc) this.fresh.set(term, (byDoc = new Map()))
      byDoc.set(id, tf)
    }
    this.freshDocs.add(id)
  }

  /** Drops a document from the overlay, leaving the disk list to speak for it. */
  #forgetFresh(id) {
    if (!this.freshDocs.delete(id)) return
    for (const [term, byDoc] of this.fresh) {
      if (byDoc.delete(id) && byDoc.size === 0) this.fresh.delete(term)
    }
  }

  /**
   * Removes a document from the index entirely - it was deleted or renamed.
   *
   * The stale posting lists on disk still name it, which is harmless: the
   * ranking skips any id that is no longer a document.
   */
  async forget(id) {
    this.#forgetFresh(id)
    this.docs.delete(id)
    this.empties.delete(id)
    this._titles?.delete(id)
    this.dirty = true
    try {
      await rm(join(this.textDir, `${id}.txt`))
    } catch {
      /* already gone */
    }
  }

  /**
   * Brings the index up to date with the configured roots. Incremental: a file
   * whose size and mtime are unchanged is not re-read at all.
   */
  async build({ onProgress = null } = {}) {
    if (this.progress.state === 'running') return this.progress
    this.cancelled = false
    this.progress = {
      state: 'running',
      scanned: 0,
      indexed: 0,
      failed: 0,
      current: null,
    }

    const seen = new Set()
    const tick = () => onProgress?.(this.status())

    for (const root of this.roots) {
      for await (const path of this.walk(root)) {
        if (this.cancelled) break
        seen.add(idFor(path))
        this.progress.scanned++
        let st
        try {
          st = await stat(path)
        } catch {
          continue
        }
        if (st.size > MAX_FILE_BYTES || !this.needsIndex(path, st)) continue

        this.progress.current = path
        try {
          await this.indexFile(path, st)
          this.progress.indexed++
        } catch (err) {
          // Scans and empty files on one side; encrypted PDFs, corrupt archives
          // and files locked by another program on the other.
          if (err instanceof EmptyDocument) {
            this.empties.set(idFor(path), { size: st.size, mtime: st.mtimeMs })
            this.dirty = true
          } else {
            this.progress.failed++
          }
        }
        if (this.progress.scanned % 25 === 0) tick()
      }
    }

    // Drop documents that no longer exist, so search cannot cite a dead path.
    if (!this.cancelled) {
      for (const [id] of this.docs) {
        if (seen.has(id)) continue
        this.docs.delete(id)
        this.dirty = true
        await rm(join(this.textDir, `${id}.txt`), { force: true })
      }
      for (const [id] of this.empties) {
        if (!seen.has(id)) this.empties.delete(id)
      }
    }

    if (this.dirty) {
      await this.buildPostings()
      await this.save()
      this.dirty = false
    }
    this.progress.state = this.cancelled ? 'cancelled' : 'idle'
    this.progress.current = null
    tick()
    return this.status()
  }

  cancel() {
    this.cancelled = true
  }

  // ---- postings -----------------------------------------------------------
  //
  // The term index stays on disk. Holding it in memory cost 1.1GB resident on a
  // real 38,000-document library - unacceptable for something that sits in the
  // tray all day. Instead postings.jsonl is written with its terms in sorted
  // order, and postings.off records where each line starts. A query binary
  // searches the offset table and reads only the handful of lines it needs, so
  // the resident cost is the offset table alone: eight bytes per distinct term.

  /**
   * Rebuilds the term index from the cached text and writes it out.
   *
   * Building still needs the whole term map in memory once, but it is packed:
   * document ids are held as small integers into `ids` rather than as 16-char
   * strings repeated in every posting list, and the file is streamed out rather
   * than assembled as one enormous string.
   */
  async buildPostings() {
    // Searches keep arriving while this runs. From closePostings() until the
    // rename, there is no consistent pair of files on disk to open - the old
    // offsets no longer describe the new postings. A reader that slipped in
    // there would either answer from mismatched files or start a second
    // rebuild on top of this one, so everyone waits on the same promise.
    if (this.rebuilding) return this.rebuilding
    this.rebuilding = this.#buildPostings().finally(() => {
      this.rebuilding = null
    })
    return this.rebuilding
  }

  async #buildPostings() {
    await this.closePostings()

    const ids = [...this.docs.keys()]
    const slot = new Map(ids.map((id, i) => [id, i]))
    const postings = new Map() // term -> flat [docSlot, tf, docSlot, tf, ...]

    for (const doc of this.docs.values()) {
      let text
      try {
        text = await readFile(join(this.textDir, `${doc.id}.txt`), 'utf8')
      } catch {
        continue
      }
      // The filename is part of what people search for.
      const counts = new Map()
      for (const t of tokenize(`${doc.name} ${text}`)) counts.set(t, (counts.get(t) ?? 0) + 1)
      doc.terms = [...counts.values()].reduce((a, b) => a + b, 0)
      const s = slot.get(doc.id)
      for (const [term, tf] of counts) {
        let list = postings.get(term)
        if (!list) postings.set(term, (list = []))
        list.push(s, tf)
      }
    }

    // Sorted, because that is what makes the on-disk binary search possible.
    const terms = [...postings.keys()].sort()
    const offsets = Buffer.allocUnsafe(terms.length * 8)
    const tmpPostings = `${this.postingsFile}.tmp`
    const tmpOffsets = `${this.offsetsFile}.tmp`

    const out = createWriteStream(tmpPostings)
    let pos = 0
    for (let i = 0; i < terms.length; i++) {
      const flat = postings.get(terms[i])
      const list = []
      for (let j = 0; j < flat.length; j += 2) list.push([ids[flat[j]], flat[j + 1]])
      const buf = Buffer.from(`${JSON.stringify([terms[i], list])}\n`, 'utf8')
      offsets.writeBigUInt64LE(BigInt(pos), i * 8)
      pos += buf.length
      if (!out.write(buf)) await once(out, 'drain')
    }
    out.end()
    await once(out, 'finish')

    await writeFile(tmpOffsets, offsets)
    // Rename last, and offsets first: a half-written pair must never be read.
    await rename(tmpPostings, this.postingsFile)
    // Everything the overlay was standing in for is now on disk.
    this.fresh.clear()
    this.freshDocs.clear()
    await rename(tmpOffsets, this.offsetsFile)
    this.postingsBytes = pos
  }

  /**
   * Opens the on-disk term index, building it if it is missing.
   *
   * The build can take a minute on a large library, and several searches can
   * ask for it at once, so the work is memoised - the second caller waits on
   * the first rather than starting a second rebuild.
   */
  ensurePostings() {
    if (this.rebuilding) return this.rebuilding.then(() => this.ensurePostings())
    if (this.fd) return Promise.resolve()
    this.opening ??= this.#openPostings().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  async #openPostings() {
    try {
      this.offsets = await readFile(this.offsetsFile)
      const st = await stat(this.postingsFile)
      this.postingsBytes = st.size
      this.fd = await open(this.postingsFile, 'r')
    } catch {
      await this.buildPostings()
      this.offsets = await readFile(this.offsetsFile)
      this.fd = await open(this.postingsFile, 'r')
    }
  }

  async closePostings() {
    const fd = this.fd
    this.fd = null
    this.offsets = null
    if (fd) await fd.close()
  }

  /** Number of distinct terms in the index. */
  get termCount() {
    return this.offsets ? this.offsets.length / 8 : 0
  }

  /** Byte range of the nth line of the postings file, newline excluded. */
  #span(n) {
    const start = Number(this.offsets.readBigUInt64LE(n * 8))
    const next =
      n + 1 < this.termCount ? Number(this.offsets.readBigUInt64LE((n + 1) * 8)) : this.postingsBytes
    return { start, length: next - start - 1 }
  }

  async #lineAt(n) {
    const { start, length } = this.#span(n)
    const buf = Buffer.allocUnsafe(length)
    await this.fd.read(buf, 0, length, start)
    return JSON.parse(buf.toString('utf8'))
  }

  /**
   * The posting list for one term as [[docId, tf], ...], read from disk.
   * Returns an empty list for a term the index has never seen.
   */
  async lookup(term) {
    const list = await this.#lookupOnDisk(term)
    if (this.freshDocs.size === 0) return list
    // A document in the overlay may also sit in the disk list, from before it
    // was edited. The overlay is the newer of the two, so the disk entry goes.
    const merged = list.filter(([id]) => !this.freshDocs.has(id))
    for (const [id, tf] of this.fresh.get(term) ?? []) merged.push([id, tf])
    return merged
  }

  async #lookupOnDisk(term) {
    await this.ensurePostings()
    let lo = 0
    let hi = this.termCount - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const [found, list] = await this.#lineAt(mid)
      if (found === term) return list
      if (found < term) lo = mid + 1
      else hi = mid - 1
    }
    return []
  }

  readText(id) {
    return readFile(join(this.textDir, `${id}.txt`), 'utf8')
  }

  /** A path is readable only if it sits inside one of the configured roots. */
  contains(path) {
    const p = path.toLowerCase()
    return this.roots.some((r) => {
      const root = r.toLowerCase().replace(/[\\/]+$/, '')
      return p === root || p.startsWith(root + sep) || p.startsWith(root + '/')
    })
  }
}
