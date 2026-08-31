// Client for the local library. Every call here is to 127.0.0.1 - the service
// on this machine that owns the index. Nothing in this file talks to Claude.
import { shell } from './shell'

export interface DocHit {
  id: string
  path: string
  name: string
  ext: string
  size: number
  mtime: number
  chars: number
  score: number
  passage: { text: string; offset: number; hits: number } | null
}

export interface DocsStatus {
  roots: string[]
  documents: number
  state: 'idle' | 'running' | 'cancelled'
  scanned: number
  indexed: number
  /** Parsed fine, held no text - almost always a scanned PDF with no text layer. */
  empty: number
  failed: number
  current: string | null
  building: boolean
}

/**
 * A passage the user has approved. Only the reference travels to /api/chat -
 * the service slices the text out of its own cache, so what was shown in the
 * sheet and what is sent are the same bytes.
 */
export interface Attachment {
  id: string
  offset: number
  length: number
}

const get = async <T>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

const post = async <T>(url: string, body: unknown): Promise<T | null> => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    return (await res.json()) as T
  } catch {
    return null
  }
}

export const docsStatus = () => get<DocsStatus>('/api/docs/status')
export const reindex = () => post<DocsStatus>('/api/docs/reindex', {})
export const cancelIndex = () => post<{ ok: boolean }>('/api/docs/cancel', {})
export const addRoot = (add: string) => post<{ roots: string[] }>('/api/docs/roots', { add })
export const removeRoot = (remove: string) => post<{ roots: string[] }>('/api/docs/roots', { remove })

export async function searchDocs(query: string, limit = 8): Promise<DocHit[]> {
  const r = await get<{ terms: string[]; results: DocHit[] }>(
    `/api/docs/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  )
  return r?.results ?? []
}

export interface DocText extends DocHit {
  text: string
  truncated: boolean
}

export const docText = (id: string, q?: string) =>
  get<DocText>(`/api/docs/text?id=${encodeURIComponent(id)}${q ? `&q=${encodeURIComponent(q)}` : ''}`)

/**
 * Handing a document to the rest of the machine.
 *
 * Both take an id, never a path: the shell resolves it against the index, so
 * the renderer cannot name an arbitrary file to launch. In a browser tab there
 * is no shell at all, which is not a failure worth reporting as one - the
 * caller gets 'unsupported' and can say so plainly.
 */
export type HandoffResult = 'ok' | 'failed' | 'unsupported'

const handoff = async (fn: ((id: string) => Promise<boolean>) | undefined, id: string) => {
  if (!fn) return 'unsupported' as const
  try {
    return (await fn(id)) ? ('ok' as const) : ('failed' as const)
  } catch {
    return 'failed' as const
  }
}

export const openDocument = (id: string) => handoff(shell?.openDocument, id)
export const revealDocument = (id: string) => handoff(shell?.revealDocument, id)

/** Trims a Windows path down to something that fits on one line. */
export function shortPath(path: string, keep = 3): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= keep) return path
  return '…\\' + parts.slice(-keep).join('\\')
}
