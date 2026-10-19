import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import inviteHandler from './api/invite-user.ts'

/* ------------------------------------------------------------------ *
 * Local stand-in for the Vercel function in /api/invite-user.
 *
 * That handler is what makes invitations work in production: it holds the Supabase service-role
 * key, which must never reach the browser. Vite does not run files in /api/, so on localhost the
 * button used to hit a 404 and surface a generic "something went wrong".
 *
 * This re-uses the handler itself rather than reimplementing it, so the admin check, input
 * validation and open-redirect guard stay identical in dev and production. Only the Vercel
 * req/res plumbing is adapted here.
 * ------------------------------------------------------------------ */

/** Read the raw body. The handler accepts a JSON string and parses it itself. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Chainable res.status(...).json(...) adapter matching the Vercel response shape. */
function toVercelRes(res: ServerResponse) {
  const adapter = {
    status(code: number) {
      res.statusCode = code
      return adapter
    },
    json(body: unknown) {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
      return adapter
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value)
      return adapter
    },
  }
  return adapter
}

function localApi(env: Record<string, string>): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/invite-user', (req, res) => {
        // The handler reads these from process.env; Vite only puts VITE_ vars there.
        for (const key of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
          if (env[key]) process.env[key] ||= env[key]
        }
        void (async () => {
          const body = await readBody(req)
          await inviteHandler({ method: req.method, headers: req.headers, body }, toVercelRes(res))
        })().catch((error: unknown) => {
          if (res.headersSent) return
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invite failed' }))
        })
      })
    },
  }
}

/** `.env` is read here because the service-role key is server-only and never reaches the client. */
function readDotEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
      if (match?.[1]) out[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
    }
  } catch {
    // no .env — the handler reports its own configuration error
  }
  return out
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApi(readDotEnv())],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    // Vite 8 rejects unknown Host headers (DNS-rebinding guard) with a 403, which blocks the
    // app when it is opened through the tunnel. This host is the account's auto-assigned ngrok
    // dev domain — ngrok documents it as stable across agent restarts.
    allowedHosts: ['anaerobic-debate-buccaneer.ngrok-free.dev'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
