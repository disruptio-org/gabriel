// The registry of credential-bearing providers.
//
// Until voice arrived there was exactly one credential in this app, and three
// separate files each knew its variable name by heart: the .env rewriter, the
// desktop vault, and the service's own health check. Adding a second provider
// meant editing all three in the same way, which is the shape of a fact that
// wants to live in one place.
//
// This module holds that fact and nothing else. It does not verify keys - that
// is provider-specific network work and belongs with the code that can make the
// call. It only answers: which providers exist, where does each one's key live
// in the environment, and what may be shown about it (§16 - the last four
// characters, never the key).

export const PROVIDERS = {
  anthropic: {
    label: 'Claude',
    env: 'ANTHROPIC_API_KEY',
    // An OAuth-style token is accepted in place of a key, but only as ambient
    // configuration: it is never written by the app, so it has no hint.
    fallbackEnv: 'ANTHROPIC_AUTH_TOKEN',
    prefix: 'sk-ant-',
    rejection: 'That does not look like an Anthropic API key.',
  },
  openai: {
    label: 'OpenAI',
    env: 'OPENAI_API_KEY',
    fallbackEnv: null,
    // Project and service-account keys are 'sk-proj-' and 'sk-svcacct-', so the
    // check has to stay at the common prefix rather than the classic shape.
    prefix: 'sk-',
    rejection: 'That does not look like an OpenAI API key.',
  },
}

/** The provider whose credential gates the application itself. */
export const PRIMARY = 'anthropic'

export const PROVIDER_IDS = Object.keys(PROVIDERS)

export const isProvider = (id) => typeof id === 'string' && Object.hasOwn(PROVIDERS, id)

/** The stored key, or the ambient fallback token where the provider allows one. */
export function keyOf(id) {
  const p = PROVIDERS[id]
  if (!p) return null
  return process.env[p.env] || (p.fallbackEnv ? process.env[p.fallbackEnv] : null) || null
}

export const hasKey = (id) => Boolean(keyOf(id))

/**
 * The last four characters, and nothing else. The UI needs to show *which* key
 * is stored without ever displaying it again after storage (§16).
 *
 * Only the key the app itself stored has a hint; an ambient fallback token is
 * not ours to describe.
 */
export function keyHint(id) {
  const k = PROVIDERS[id] ? (process.env[PROVIDERS[id].env] ?? '') : ''
  return k.length > 4 ? `•••• ${k.slice(-4)}` : null
}

/** Puts a verified key into the environment, or removes it when passed null. */
export function setKeyEnv(id, key) {
  const p = PROVIDERS[id]
  if (!p) return
  if (key === null) delete process.env[p.env]
  else process.env[p.env] = key
}

/** What /api/health reports: one entry per provider, hints only. */
export function providerHealth() {
  return Object.fromEntries(
    PROVIDER_IDS.map((id) => [
      id,
      { label: PROVIDERS[id].label, connected: hasKey(id), hint: keyHint(id) },
    ]),
  )
}
