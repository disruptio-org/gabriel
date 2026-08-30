// Standalone entry point for the service (npm run svc). The desktop shell does
// not use this - it imports startServer directly and picks its own port.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { startServer, MODELS } from './index.mjs'
import { envStore } from './env-store.mjs'
import { defaultRoots } from './docs/roots.mjs'

// Running from source: the key lives in the project's .env.
const { port } = await startServer({
  persist: envStore(new URL('../.env', import.meta.url).pathname.replace(/^\//, '')),
  // Running from source, the index lives beside the project rather than in the
  // installed app's user data, so dev work never disturbs the real library.
  docsDir: join(homedir(), '.personal-intelligence-dev', 'index'),
  docsRoots: defaultRoots(),
})
const key = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
console.log(
  `[svc] Ø service on http://127.0.0.1:${port}  (key ${key ? 'loaded' : 'MISSING'}, ` +
    `${MODELS.length} models)`,
)
