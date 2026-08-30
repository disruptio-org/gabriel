// Standalone entry point for the service (npm run svc). The desktop shell does
// not use this - it imports startServer directly and picks its own port.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { startServer, MODELS } from './index.mjs'
import { envStore } from './env-store.mjs'
import { defaultRoots } from './docs/roots.mjs'
import { PROVIDERS, PROVIDER_IDS, hasKey } from './providers.mjs'

// Running from source: the keys live in the project's .env, one variable each.
const writeVar = envStore(new URL('../.env', import.meta.url).pathname.replace(/^\//, ''))

const { port } = await startServer({
  persist: (provider, key) => writeVar(PROVIDERS[provider].env, key),
  // Running from source, the index lives beside the project rather than in the
  // installed app's user data, so dev work never disturbs the real library.
  docsDir: join(homedir(), '.personal-intelligence-dev', 'index'),
  docsRoots: defaultRoots(),
})
const keys = PROVIDER_IDS.map((id) => `${id} ${hasKey(id) ? 'loaded' : 'MISSING'}`).join(', ')
console.log(`[svc] Ø service on http://127.0.0.1:${port}  (${keys}, ${MODELS.length} models)`)
