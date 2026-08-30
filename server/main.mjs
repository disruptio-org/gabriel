// Standalone entry point for the service (npm run svc). The desktop shell does
// not use this - it imports startServer directly and picks its own port.
import { startServer, MODELS } from './index.mjs'

const { port } = await startServer()
const key = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
console.log(
  `[svc] Ø service on http://127.0.0.1:${port}  (key ${key ? 'loaded' : 'MISSING'}, ` +
    `${MODELS.length} models)`,
)
