import type { FoundDoc } from './lib/claude'

export type Role = 'user' | 'assistant'

export type ErrorKind = 'no_key' | 'auth' | 'rate_limit' | 'offline' | 'api' | 'refusal'

export interface Message {
  id: string
  role: Role
  content: string
  /** Set on assistant turns that failed; the turn is excluded from later context. */
  error?: ErrorKind
  /** Detail behind an error, revealed on demand rather than shown by default. */
  detail?: string
  /** User stopped generation partway; partial content is kept. */
  stopped?: boolean
  /**
   * Documents Ø turned up while answering this turn, in the order it found
   * them. Metadata only: nothing here has been read, and acting on one of them
   * is the user's move, not Ø's.
   */
  found?: FoundInTurn[]
}

/** One search Ø ran, and what came back. */
export interface FoundInTurn {
  query: string
  results: FoundDoc[]
}

export type Phase = 'desktop' | 'boot' | 'chat'
export type AnimationMode = 'full' | 'reduced' | 'off'
