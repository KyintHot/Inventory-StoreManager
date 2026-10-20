#!/usr/bin/env node
/* Read-only smoke check against the real Supabase project configured in .env.
 *
 * The Vitest suite proves the SQL migrations and RLS policies in PGlite; this script proves the
 * same things on the ACTUAL project, without a session and without writing a single row:
 *   1. the project is reachable and Auth answers,
 *   2. the tables the app depends on are exposed by PostgREST,
 *   3. a signed-out request cannot read a single row (privileges/RLS are locked down),
 *   4. the import RPCs exist but are not callable without an admin session,
 *   5. whether the invoice -> sales mirroring migration (20261019000001) is applied, using a
 *      deliberately missing function as a control so a 404 is never read as a denial,
 *   6. (when SUPABASE_SERVICE_ROLE_KEY is set) whether the service role may execute the RPCs
 *      at all — migration 20261020000001_grant_service_role_functions.sql grants that; before
 *      it, every server-side RPC call died with "permission denied for function ...".
 *
 * Nothing is inserted, updated or deleted, and no key is ever printed.
 * Exit code 0 = every check passed; 1 = at least one failed.
 *
 * Usage: npm run smoke:live
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

// --- configuration (read .env like Vite does: no dependency on dotenv) -------------------------
function readEnv() {
  const out = {}
  for (const file of ['.env', '.env.local']) {
    try {
      for (const line of readFileSync(path.resolve(file), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
        if (m && m[2] !== '' && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      /* file may not exist */
    }
  }
  return out
}

const env = readEnv()
const URL_BASE = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const ANON = env.VITE_SUPABASE_ANON_KEY || ''

if (!URL_BASE || !ANON) {
  console.error('✖ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing — copy .env.example to .env first.')
  process.exit(1)
}

const rest = (p) => `${URL_BASE}/rest/v1${p}`
const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }

const results = []
const record = (ok, label, detail) => {
  results.push({ ok, label })
  console.log(`${ok ? '✅' : '✖'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function probe(pathname, init = {}) {
  try {
    const res = await fetch(rest(pathname), { ...init, headers: { ...headers, ...(init.headers || {}) } })
    const text = await res.text().catch(() => '')
    return { status: res.status, text: text.slice(0, 300) }
  } catch (e) {
    return { status: 0, text: String(e) }
  }
}

console.log(`\nRead-only smoke check — ${new URL(URL_BASE).host}\n`)

// 1. project reachable + Auth up ----------------------------------------------------------------
try {
  const res = await fetch(`${URL_BASE}/auth/v1/health`, { headers: { apikey: ANON } })
  record(res.ok, 'Auth service answers', `GET /auth/v1/health → ${res.status}`)
} catch (e) {
  record(false, 'Auth service answers', String(e))
}

// 2. tables the app depends on are exposed ------------------------------------------------------
const TABLES = ['products', 'sales', 'tax_invoices', 'profiles', 'company_profile', 'monthly_targets', 'sync_logs', 'product_stock_history']
for (const table of TABLES) {
  const r = await probe(`/${table}?select=id&limit=1`)
  // 404 = table missing (migration not applied); 401/403 = exists but locked to signed-out clients;
  // 200 = reachable (RLS then decides the rows — see check 3).
  record(r.status !== 404 && r.status !== 0, `table public.${table} exists`, `status ${r.status}`)
}

// 3. signed-out clients must not see any data ----------------------------------------------------
for (const table of ['products', 'sales', 'tax_invoices', 'profiles']) {
  const r = await probe(`/${table}?select=id&limit=1`)
  const rowsVisible = r.status === 200 && !/^\s*\[\s*\]\s*$/.test(r.text) && /^\s*\[/.test(r.text)
  record(!rowsVisible && r.status !== 0, `signed-out read of ${table} returns no rows`, `status ${r.status}`)
}

// 4. import RPCs exist and are closed without an admin session ----------------------------------
// PostgREST resolves the function signature BEFORE checking privileges, so an empty `{}` body
// gets 404 "no match" even for functions that exist. Send a payload that matches each
// signature (all no-ops: empty arrays, nonexistent id) so a 401/403 means "exists + denied".
const EMPTY_BODIES = {
  import_products: { p_rows: [], p_file_name: '' },
  import_sales: { p_rows: [], p_file_name: '' },
  import_invoices: { p_rows: [], p_file_name: '' },
  save_invoice: {
    p_id: '00000000-0000-0000-0000-000000000000', p_customer_name: '', p_customer_tax_id: '',
    p_customer_address: '', p_customer_branch: '', p_doc_date: '2026-01-01', p_items: [],
    p_discount: 0, p_vat_rate: 7, p_note: '',
  },
}
for (const [fn, body] of Object.entries(EMPTY_BODIES)) {
  const r = await probe(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) })
  record(r.status === 401 || r.status === 403, `rpc ${fn} exists and rejects signed-out calls`, `status ${r.status}`)
}

// 5. is the invoice -> sales mirror migration applied? (self-calibrating probe) ------------------
// PostgREST answers 404 for a function it cannot find; a function that EXISTS but is not
// executable by the caller is reported as 401/403. Two controls make the reading safe:
//   • rpc/definitely_not_a_real_function → 404 proves "missing ⇒ 404"
//   • rpc/import_invoices               → 401/403 proves "exists + denied ⇒ 401/403"
const missing = await probe('/rpc/definitely_not_a_real_function', { method: 'POST', body: '{}' })
const denied = await probe('/rpc/import_invoices', { method: 'POST', body: JSON.stringify(EMPTY_BODIES.import_invoices) })
// p_docs = [] (not null): matches the signature but selects zero documents, so the mirror
// cannot write a single row even if the call were to succeed.
const mirror = await probe('/rpc/sync_invoice_sales', { method: 'POST', body: '{"p_docs": []}' })

const missingIs404 = missing.status === 404
const deniedIsAuthError = denied.status === 401 || denied.status === 403
if (missingIs404 && deniedIsAuthError) {
  if (mirror.status === 401 || mirror.status === 403) {
    record(true, 'migration 20261019000001 (invoice → sales mirror) is applied', `rpc sync_invoice_sales → ${mirror.status}`)
  } else {
    record(false, 'migration 20261019000001 (invoice → sales mirror) is applied', `rpc sync_invoice_sales → ${mirror.status}; run it in the SQL editor`)
  }
} else {
  console.log(`ℹ️ cannot distinguish "missing" from "denied" on this project (controls: missing=${missing.status}, denied=${denied.status}) — migration 20261019000001 not confirmed either way`)
}

// summary ----------------------------------------------------------------------------------------
// 6. service-role RPC execution (optional: needs SUPABASE_SERVICE_ROLE_KEY) ---------------------
// An empty row array is a guaranteed no-op for the import functions, and without an admin
// claim they stop at require_admin(), so nothing can be written either way. We only read the
// error LAYER: "permission denied" means the EXECUTE grant is missing; any other answer
// means the grant is in place and the business rules took over.
const skey = env.SUPABASE_SERVICE_ROLE_KEY
if (!skey) {
  console.log('ℹ️ SUPABASE_SERVICE_ROLE_KEY not set — skipping the service-role RPC check')
} else {
  const res = await fetch(rest('/rpc/import_products'), {
    method: 'POST',
    headers: { apikey: skey, Authorization: `Bearer ${skey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_rows: [], p_file_name: '' }),
  })
  const text = await res.text().catch(() => '')
  record(!/permission denied/i.test(text), 'service role may execute RPCs (migration 20261020000001)',
    `POST /rpc/import_products → ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 120)}${/permission denied/i.test(text) ? ' — apply supabase/migrations/20261020000001_grant_service_role_functions.sql in the SQL editor' : ''}`)
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? ` — ${failed} FAILED` : ''}\n`)
process.exit(failed ? 1 : 0)
