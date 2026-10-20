// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Migration 20261013000003 revoked the default PUBLIC execute grant and re-granted an
 * explicit list, so a function missing from that list is unusable by clients — and the same
 * gap left the service role unable to call anything until 20261020000001 (observed live as
 * "permission denied for function ..." on every RPC). CLAUDE.md's manual rule — "new
 * functions must be added to the grant list" — is easy to forget, so this test parses the
 * migrations and enforces it: coverage in both directions, exact signatures, no anon.
 */

const DIR = path.resolve(__dirname, '../../supabase/migrations')
const sql = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(path.join(DIR, f), 'utf8'))
  .join('\n')

/** Split a comma-separated list without breaking on commas inside parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

/** "p_a text, p_b text[] default ''" -> "text,text[]" (parameter names and defaults dropped). */
function argTypes(args: string): string {
  return splitTop(args)
    .map((a) => a.replace(/\s+default\s+[\s\S]*$/i, '').trim().split(/\s+/).slice(1).join(' '))
    .join(',')
}

/** "name(type,type)" for every `create [or replace] function public.x(...)` in the migrations. */
const created = new Map<string, string>()
for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\b/gi)) {
  created.set(m[1]!.toLowerCase(), `${m[1]!.toLowerCase()}(${argTypes(m[2]!)})`)
}

/** Functions executed by a trigger: they run with the owner's rights, no client grant needed. */
const triggerFns = new Set(
  [...sql.matchAll(/execute\s+(?:function|procedure)\s+public\.(\w+)/gi)].map((m) => m[1]!.toLowerCase()),
)

/** Internal helpers only ever called from inside other SECURITY DEFINER functions. */
const INTERNAL = new Map([
  ['require_admin', 'raises unless the caller is admin; called inside other definer functions'],
  ['sync_invoice_sales', 'mutates sales for a whole bill; called by import_invoices/save_invoice only'],
])

/**
 * Execute privileges for `role` after every migration has run. Statements are applied in
 * file order, last one wins — like Postgres: 20261013000003 revokes the blanket PUBLIC
 * grant before re-granting the explicit list, so a naive grants-minus-revokes would be
 * wrong.
 */
function privileges(role: string): Set<string> {
  const state = new Set<string>()
  const stmt = /(grant|revoke)\s+execute\s+on\s+(all\s+functions\s+in\s+schema\s+public|function[\s\S]*?)\s+(to|from)\s+([a-z_,\s]+?)\s*;/gi
  for (const m of sql.matchAll(stmt)) {
    const roles = m[4]!.split(',').map((r) => r.trim())
    if (!roles.includes(role)) continue
    const grant = m[1]!.toLowerCase() === 'grant'
    const entries = m[2]!.toLowerCase().startsWith('all')
      ? [...created.values()]
      : splitTop(m[2]!.replace(/^function\s+/i, '')).map((e) => e.replace(/^public\./, '').replace(/\s+/g, ''))
    for (const sig of entries) {
      if (grant) state.add(sig)
      else state.delete(sig)
    }
  }
  return state
}

const createdSigs = new Set(created.values())

describe('migration function grants', () => {
  it('finds the functions it is supposed to police', () => {
    expect(created.size).toBeGreaterThanOrEqual(25)
    expect(created.has('import_products')).toBe(true)
    expect(created.has('sync_invoice_sales')).toBe(true)
  })

  it('grants authenticated every client-callable function, with exact signatures', () => {
    const granted = privileges('authenticated')
    const missing = [...created]
      .filter(([name, sig]) => !triggerFns.has(name) && !INTERNAL.has(name) && !granted.has(sig))
      .map(([, sig]) => sig)
    expect(missing).toEqual([])
  })

  it('has no stale grant entries (a changed signature would silently break clients)', () => {
    const stale = [...privileges('authenticated')].filter((sig) => !createdSigs.has(sig))
    expect(stale).toEqual([])
  })

  it('grants the service role everything the browser gets (migration 20261020000001)', () => {
    const svc = privileges('service_role')
    const missing = [...privileges('authenticated')].filter((sig) => !svc.has(sig))
    expect(missing).toEqual([])
  })

  it('grants anon nothing, ever', () => {
    expect([...privileges('anon')]).toEqual([])
  })

  it('only marks internal functions as ungranted, and each is really called internally', () => {
    const ungranted = [...created].filter(([name, sig]) => !triggerFns.has(name) && !privileges('authenticated').has(sig))
    expect(ungranted.map(([name]) => name).sort()).toEqual([...INTERNAL.keys()].sort())
    // sync_invoice_sales must stay revoked for clients even though it is created in 20261019.
    expect(sql).toMatch(/revoke execute on function public\.sync_invoice_sales\(text\[\]\)/)
  })

  it('every RPC the frontend calls exists in the migrations', () => {
    const srcDir = path.resolve(__dirname, '../../src/services')
    const called = new Set<string>()
    for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(path.join(srcDir, f), 'utf8').matchAll(/\.rpc\(\s*['"`]([a-z_]+)['"`]/g)) {
        called.add(m[1]!)
      }
    }
    expect(called.size).toBeGreaterThan(5)
    expect([...called].filter((n) => !created.has(n))).toEqual([])
  })
})
