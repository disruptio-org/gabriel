// The local document index.
//
// Everything here reads the disk and writes to this machine's own app data.
// There is no network call in this file, and no document text is ever handed
// to the model without the user approving it first (see /api/docs/search and
// the approval sheet in the renderer).
import { readdir, stat, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
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

/** Accent-folded lowercase words. "Évora" and "evora" must be the same term. */
export function tokenize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && t.length < 40)
}

const idFor = (path) => createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)

/**
 * On-disk layout, all under the app's own user-data directory:
 *   index/manifest.json   roots, settings, one record per indexed document
 *   index/postings.jsonl  term -> doc frequencies, rebuilt whenever docs change
 *   index/text/<id>.txt   extracted text, so a passage can be shown without
 *                         re-parsing a 200-page PDF
 */
export class DocIndex {
  constructor(dir) {
    this.dir = dir
    this.textDir = join(dir, 'text')
    this.manifestFile = join(dir, 'manifest.json')
    this.postingsFile = join(dir, 'postings.jsonl')

    this.roots = []
    this.docs = new Map() // id -> { id, path, name, ext, size, mtime, chars, indexedAt }
    // Files that parsed but held no text. Remembered so a folder of 14,000
    // scanned PDFs is not re-parsed from scratch on every single crawl - each
    // one costs a full pdf.js pass to learn the same nothing.
    this.empties = new Map() // id -> { size, mtime }
    this.postings = null // term -> Map(id -> tf), loaded lazily
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
    try {
      const m = JSON.parse(await readFile(this.manifestFile, 'utf8'))
      this.roots = m.roots ?? []
      for (const d of m.docs ?? []) this.docs.set(d.id, d)
      for (const [id, meta] of m.empties ?? []) this.empties.set(id, meta)
    } catch {
      /* first run */
    }
    return this
  }

  async save() {
    const payload = {
      version: 1,
      roots: this.roots,
      docs: [...this.docs.values()],
      empties: [...this.empties],
    }
    await writeFile(this.manifestFile, JSON.stringify(payload), 'utf8')
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
        if (!SUPPORTED.has(extname(e.name).toLowerCase())) continue
        if (isSecretName(e.name)) continue
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

  async indexFile(path, st) {
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
    return id
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

  /** Rebuilds the term index from the cached text and writes it out. */
  async buildPostings() {
    const postings = new Map()
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
      for (const [term, tf] of counts) {
        let list = postings.get(term)
        if (!list) postings.set(term, (list = new Map()))
        list.set(doc.id, tf)
      }
    }
    this.postings = postings

    const lines = []
    for (const [term, list] of postings) lines.push(JSON.stringify([term, [...list]]))
    await writeFile(this.postingsFile, lines.join('\n'), 'utf8')
  }

  /** Loads the term index on first search rather than at launch. */
  async ensurePostings() {
    if (this.postings) return this.postings
    try {
      const raw = await readFile(this.postingsFile, 'utf8')
      const postings = new Map()
      for (const line of raw.split('\n')) {
        if (!line) continue
        const [term, list] = JSON.parse(line)
        postings.set(term, new Map(list))
      }
      this.postings = postings
    } catch {
      await this.buildPostings()
    }
    return this.postings
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
