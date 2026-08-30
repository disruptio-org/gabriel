import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SERVICE = `http://127.0.0.1:${process.env.PI_PORT ?? 8787}`

// The renderer never holds the API key; every model call is proxied to the
// local service, which is the only process that reads ANTHROPIC_API_KEY.
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
    proxy: { '/api': { target: SERVICE, changeOrigin: true } },
  },
  build: { target: 'es2022' },
  plugins: [react()],
})
