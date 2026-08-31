// Keeping the index level with the disk.
//
// Without this the index is a photograph: accurate at the moment REINDEX was
// pressed, and progressively less true afterwards. A file saved this morning
// does not exist as far as Ø is concerned, which is the one case where the
// user is most certain it does.
//
// Nothing here decides what may be indexed. That question is answered by
// crawlable() in index.mjs, the same function the crawl uses, so a folder the
// crawl refuses to enter is not reachable by saving a file into it either.
import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { crawlable, idFor, EmptyDocument } from './index.mjs'

/** How long to wait after the last event before acting on a burst. */
const QUIET_MS = 1500

/**
 * How many files one batch will index before yielding.
 *
 * A git checkout or an unzip can touch thousands of files at once. Working
 * through all of them in one pass would block searches for as long as it took,
 * so a batch is bounded and the remainder waits for the next tick.
 */
const BATCH = 200

/**
 * How many changed documents may accumulate before the term index is rewritten.
 *
 * Each one lives in memory until then (see the overlay in index.mjs). A few
 * hundred is nothing; a hundred thousand, after some tool rewrites a tree,
 * would be a leak.
 */
const REBUILD_AFTER = 400

/**
 * The shortest gap between manifest writes.
 *
 * The manifest is the whole library in one file - megabytes of it - and a batch
 * may be a single saved document. Rewriting all of it every time a file is
 * touched is disk the user paid for and did not ask to spend. Nothing is lost
 * by waiting: the changes are already in the index in memory, and a save that
 * is skipped here happens on the next batch or when the app closes.
 */
const SAVE_EVERY_MS = 30_000

export class Watcher {
  constructor(index, { onChange = null } = {}) {
    this.index = index
    this.onChange = onChange
    this.watchers = []
    this.pending = new Set()
    this.timer = null
    this.running = false
    this.stopped = false
    this.indexed = 0
    this.removed = 0
    this.unsaved = false
    this.lastSave = 0
  }

  start() {
    for (const root of this.index.roots) {
      try {
        // Recursive watching is native on Windows and macOS. Where it is not
        // supported the constructor throws, and the library simply stays as
        // up to date as the last crawl left it - which is what it was before.
        const w = watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return
          this.#queue(join(root, filename.toString()), root)
        })
        w.on('error', () => {})
        // Watching must not be a reason for the process to stay alive. The
        // desktop app has its own reasons to keep running; a test that has
        // finished asserting has none, and would otherwise hang forever.
        w.unref?.()
        this.watchers.push(w)
      } catch (err) {
        console.error('[docs] cannot watch', root, '-', err.message)
      }
    }
    return this
  }

  /**
   * Stops watching, and returns a promise for the last write.
   *
   * Awaitable because the caller may be shutting down: whatever was indexed
   * since the last save would otherwise have to be found again by the next
   * crawl, and a write still in flight would be racing the process exit.
   */
  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const w of this.watchers) w.close()
    this.watchers = []
    return this.flush().catch((err) => console.error('[docs] final save:', err.message))
  }

  #queue(path, root) {
    if (this.stopped || !crawlable(path, root)) return
    this.pending.add(path)
    // Editors write a file several times in a second - a temp file, a rename,
    // a metadata touch. Waiting for quiet means reading it once, afterwards.
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.#drain(), QUIET_MS)
    this.timer.unref?.()
  }

  async #drain() {
    this.timer = null
    if (this.running || this.stopped) return
    // A full crawl is already doing this work, and both writing the same
    // documents would have them fight over the manifest.
    if (this.index.progress.state === 'running') {
      this.timer = setTimeout(() => void this.#drain(), QUIET_MS * 4)
      return
    }

    this.running = true
    let touched = 0
    try {
      const batch = [...this.pending].slice(0, BATCH)
      for (const path of batch) {
        this.pending.delete(path)
        if (await this.#apply(path)) touched += 1
      }
      if (touched > 0) {
        this.unsaved = true
        this.onChange?.({ indexed: this.indexed, removed: this.removed })
      }
      // Everything still queued is about to be indexed too, so there is no
      // point writing the manifest between two halves of the same burst.
      if (this.unsaved && this.pending.size === 0 && Date.now() - this.lastSave >= SAVE_EVERY_MS) {
        await this.flush()
      }
      if (this.index.freshDocs.size >= REBUILD_AFTER) await this.index.buildPostings()
    } catch (err) {
      console.error('[docs] watch:', err.message)
    } finally {
      this.running = false
      if (this.pending.size > 0 && !this.stopped) {
        this.timer = setTimeout(() => void this.#drain(), 50)
      }
    }
  }

  /** Writes out whatever the watcher has indexed since the last write. */
  async flush() {
    if (!this.unsaved) return
    this.unsaved = false
    this.lastSave = Date.now()
    await this.index.save()
  }

  /** Brings one path up to date. Returns whether anything actually changed. */
  async #apply(path) {
    let st
    try {
      st = await stat(path)
    } catch {
      // Gone, or renamed away. Either way the index should stop offering it -
      // a result that opens nothing is worse than no result.
      const id = idFor(path)
      if (!this.index.docs.has(id) && !this.index.empties.has(id)) return false
      await this.index.forget(id)
      this.removed += 1
      return true
    }

    if (!st.isFile() || st.size > 25 * 1024 * 1024) return false
    if (!this.index.needsIndex(path, st)) return false

    try {
      await this.index.indexFile(path, st, { live: true })
      this.indexed += 1
      return true
    } catch (err) {
      if (err instanceof EmptyDocument) {
        this.index.empties.set(idFor(path), { size: st.size, mtime: st.mtimeMs })
        return true
      }
      // Locked by the program that is still writing it. It will be saved
      // again, and the next event will catch it.
      return false
    }
  }
}
