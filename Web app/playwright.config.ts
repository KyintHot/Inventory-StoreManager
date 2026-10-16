import { defineConfig } from '@playwright/test'

const PORT = 5199

/**
 * UI tests run the real app in a real browser against a STUBBED Supabase HTTP API
 * (see e2e/fakeSupabase.ts). They verify front-end behaviour, responsiveness and role-based UI.
 * They do NOT verify the database: RLS/RPC logic is covered by tests/db (PGlite), and a live
 * Supabase project has not been exercised yet.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL ?? 'chrome', // uses the locally installed browser; no download needed
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: 'https://stub.supabase.test',
      VITE_SUPABASE_ANON_KEY: 'stub-anon-key',
    },
  },
})
