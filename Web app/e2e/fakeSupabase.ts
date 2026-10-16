import type { Page, Route } from '@playwright/test'

/**
 * A tiny in-memory stand-in for the Supabase HTTP API (Auth + PostgREST + RPC), intercepted at the
 * network layer. It mirrors response SHAPES so the UI can be exercised; it does not enforce RLS.
 * Authorization is tested against real Postgres policies in tests/db.
 */
export const HOST = 'https://stub.supabase.test'

type Json = Record<string, any>

export interface FakeDb {
  role: 'admin' | 'user'
  userId: string
  email: string
  products: Json[]
  sales: Json[]
  invoices: Json[]
  company: Json
  targets: Json[]
  logs: Json[]
  profiles: Json[]
  calls: { method: string; path: string; body: any }[]
  fail?: { path: string; times: number } // requests whose path contains path return 500 	imes times
}

const product = (n: number, sku: string, th: string, en: string, cat: string, stock: number, min: number): Json => ({
  id: `p-${n}`, sku, name_th: th, name_en: en, category: cat, unit: 'ขวด', unit_price: 120 + n, cost_price: 80,
  stock_qty: stock, min_stock: min, restock_qty: Math.max(0, min - stock),
  stock_state: min <= 0 ? 'ok' : stock <= min * 0.2 ? 'critical' : stock <= min ? 'low' : 'ok', supplier: '', is_active: true,
})

export function createFakeDb(role: 'admin' | 'user' = 'admin'): FakeDb {
  const userId = role === 'admin' ? 'u-admin' : 'u-staff'
  return {
    role,
    userId,
    email: role === 'admin' ? 'owner@ole.test' : 'staff@ole.test',
    products: [
      product(1, 'HNY-001', 'น้ำผึ้งดอกไม้ป่า 500 มล.', 'Wild flower honey 500ml', 'Honey', 4, 40),
      product(2, 'HNY-002', 'น้ำผึ้งลำไย 250 มล.', 'Longan honey 250ml', 'Honey', 30, 40),
      product(3, 'SYR-001', 'ไซรัปน้ำผึ้งมะนาว', 'Honey lime syrup', 'Syrup', 90, 40),
      product(4, 'SYR-002', 'ไซรัปน้ำผึ้งขิง', 'Honey ginger syrup', 'Syrup', 0, 0),
    ],
    sales: [
      { id: 's1', bill_no: 'IV6910-001', sale_date: '2026-10-02', sku: 'HNY-001', product_name: 'น้ำผึ้งดอกไม้ป่า 500 มล.', qty: 10, unit: 'ขวด', unit_price: 121, amount: 1210, customer_name: 'ร้านสุขใจ' },
      { id: 's2', bill_no: 'IV6910-002', sale_date: '2026-10-03', sku: 'SYR-001', product_name: 'ไซรัปน้ำผึ้งมะนาว', qty: 6, unit: 'ขวด', unit_price: 123, amount: 738, customer_name: 'ACME Trading' },
    ],
    invoices: [
      {
        id: 'i-1', doc_no: 'IV6910-001', doc_date: '2026-10-02', customer_name: 'ร้านสุขใจ', customer_tax_id: '0105560000001',
        customer_address: '12 ถ.สุขุมวิท กรุงเทพฯ', customer_branch: 'สำนักงานใหญ่', discount: 0, vat_rate: 7, subtotal: 1210, vat_amount: 84.7, total: 1294.7,
        note: '', status: 'imported', edited_by: '', edited_at: null, exported_at: null,
        items: [{ sku: 'HNY-001', description: 'น้ำผึ้งดอกไม้ป่า 500 มล.', qty: 10, unit: 'ขวด', unit_price: 121, amount: 1210 }],
      },
      {
        id: 'i-2', doc_no: 'IV6910-002', doc_date: '2026-10-03', customer_name: 'ACME Trading', customer_tax_id: '', customer_address: '',
        customer_branch: '', discount: 0, vat_rate: 7, subtotal: 738, vat_amount: 51.66, total: 789.66, note: '', status: 'exported',
        edited_by: 'owner@ole.test', edited_at: null, exported_at: '2026-10-04T03:00:00Z',
        items: [{ sku: 'SYR-001', description: 'Honey lime syrup', qty: 6, unit: 'btl', unit_price: 123, amount: 738 }],
      },
    ],
    company: { id: 1, name_th: 'บริษัท โอเล่ รสน้ำผึ้ง จำกัด', name_en: 'Ole Honey Flavor Co., Ltd.', tax_id: '0105560000000', branch: 'สำนักงานใหญ่', address: '99 ถ.พระราม 9 กรุงเทพฯ', phone: '02-000-0000', email: 'hello@ole.test', vat_rate: 7, invoice_note: '', logo_url: '' },
    targets: [{ id: 't-1', year: 2026, month: 10, target_amount: 5000 }],
    logs: [{ id: 'l-1', kind: 'sales', file_name: 'sales-oct.csv', row_count: 2, created_count: 2, updated_count: 0, skipped_count: 0, imported_by: 'owner@ole.test', note: '', created_at: '2026-10-04T03:00:00Z' }],
    profiles: [
      { id: 'u-admin', email: 'owner@ole.test', full_name: 'Owner', role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { id: 'u-staff', email: 'staff@ole.test', full_name: 'Staff', role: 'user', created_at: '2026-02-01T00:00:00Z' },
    ],
    calls: [],
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range',
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

function postgrestError(route: Route, code: string, message: string, status = 400) {
  return json(route, { code, message, details: null, hint: null }, status)
}

function asSingle(route: Route, rows: Json[], wantsObject: boolean) {
  if (!wantsObject) return json(route, rows)
  if (rows.length !== 1) return postgrestError(route, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', 406)
  return json(route, rows[0])
}

function applyProductFilter(db: FakeDb, a: Json): Json[] {
  const q = String(a.p_search ?? '').trim().toLowerCase()
  return db.products
    .filter((p) => !q || [p.sku, p.name_th, p.name_en].some((v) => String(v).toLowerCase().includes(q)))
    .filter((p) => !a.p_category || p.category === a.p_category)
    .filter((p) => (a.p_state === 'alerts' ? p.stock_state !== 'ok' : !a.p_state || a.p_state === 'all' || p.stock_state === a.p_state))
    .sort((x, y) => String(x.sku).localeCompare(String(y.sku)))
}

function salesFilter(db: FakeDb, a: Json): Json[] {
  const q = String(a.p_search ?? '').trim().toLowerCase()
  return db.sales.filter(
    (s) =>
      (!a.p_from || s.sale_date >= a.p_from) &&
      (!a.p_to || s.sale_date <= a.p_to) &&
      (!q || [s.bill_no, s.sku, s.product_name, s.customer_name].some((v) => String(v).toLowerCase().includes(q))),
  )
}

function totalsFor(items: Json[], discount: number, vatRate: number) {
  const subtotal = Math.round(items.reduce((s, i) => s + (Number(i.amount) || 0), 0) * 100) / 100
  const net = Math.max(0, subtotal - discount)
  const vat_amount = Math.round(net * vatRate) / 100
  return { subtotal, vat_amount, total: Math.round((net + vat_amount) * 100) / 100 }
}

export async function installFakeSupabase(page: Page, db: FakeDb): Promise<void> {
  await page.route(`${HOST}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()
    let body: any = null
    try {
      body = req.postDataJSON()
    } catch {
      body = null
    }
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    db.calls.push({ method, path: path + url.search, body })

    if (db.fail && db.fail.times > 0 && path.includes(db.fail.path)) {
      db.fail.times -= 1
      return postgrestError(route, 'XX000', 'boom', 500)
    }

    const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const me = db.profiles.find((p) => p.id === db.userId)!

    // ---- Auth ----
    if (path === '/auth/v1/token') {
      if (body?.password === 'wrong-password') return json(route, { error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400)
      const user = { id: db.userId, aud: 'authenticated', role: 'authenticated', email: db.email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
      return json(route, { access_token: 'stub.access.token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user })
    }
    if (path === '/auth/v1/user') return json(route, { id: db.userId, aud: 'authenticated', email: db.email, app_metadata: {}, user_metadata: {} })
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS })
    if (path === '/auth/v1/recover') return json(route, {})

    // ---- RPC ----
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop()!
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = url.searchParams.get('limit')
      const page_ = (rows: Json[]) => (limit ? rows.slice(offset, offset + Number(limit)) : rows)
      switch (fn) {
        case 'products_filtered':
          return json(route, page_(applyProductFilter(db, body)))
        case 'product_categories':
          return json(route, [...new Set(db.products.map((p) => p.category))].sort())
        case 'inventory_alert_counts':
          return json(route, { critical: db.products.filter((p) => p.stock_state === 'critical').length, low: db.products.filter((p) => p.stock_state === 'low').length })
        case 'sales_filtered':
          return json(route, page_(salesFilter(db, body)))
        case 'sales_summary': {
          const rows = salesFilter(db, body)
          return json(route, { revenue: rows.reduce((s, r) => s + r.amount, 0), units: rows.reduce((s, r) => s + r.qty, 0), bills: new Set(rows.map((r) => r.bill_no)).size, lines: rows.length })
        }
        case 'sales_by_customer': {
          const by = new Map<string, Json>()
          for (const r of salesFilter(db, body)) {
            const cur = by.get(r.customer_name) ?? { customer_name: r.customer_name, bills: 0, units: 0, revenue: 0, _b: new Set() }
            cur._b.add(r.bill_no); cur.bills = cur._b.size; cur.units += r.qty; cur.revenue += r.amount
            by.set(r.customer_name, cur)
          }
          return json(route, [...by.values()].map(({ _b, ...v }) => v).sort((a, b) => b.revenue - a.revenue))
        }
        case 'dashboard_summary': {
          const alerts = db.products.filter((p) => p.stock_state !== 'ok').sort((a, b) => a.stock_qty - b.stock_qty)
          const revenue = db.sales.reduce((s, r) => s + r.amount, 0)
          return json(route, {
            revenue, units: db.sales.reduce((s, r) => s + r.qty, 0), bills: new Set(db.sales.map((r) => r.bill_no)).size,
            trend: [{ month: '2026-08', revenue: 900 }, { month: '2026-09', revenue: 1500 }, { month: '2026-10', revenue }],
            topSkus: [{ sku: 'HNY-001', name_th: 'น้ำผึ้งดอกไม้ป่า 500 มล.', name_en: 'Wild flower honey 500ml', qty: 10, revenue: 1210 }],
            alerts: alerts.slice(0, 5), alertCount: alerts.length,
            target: db.targets.find((t) => t.year === body.p_year && t.month === body.p_month) ?? null,
            lastLog: db.logs[0] ?? null,
          })
        }
        case 'save_invoice': {
          const inv = db.invoices.find((i) => i.id === body.p_id)
          if (!inv) return postgrestError(route, 'P0002', 'Invoice not found', 404)
          Object.assign(inv, {
            customer_name: body.p_customer_name, customer_tax_id: body.p_customer_tax_id, customer_address: body.p_customer_address,
            customer_branch: body.p_customer_branch, doc_date: body.p_doc_date, items: body.p_items, discount: body.p_discount,
            vat_rate: body.p_vat_rate, note: body.p_note, edited_by: db.email, status: inv.status === 'exported' ? 'exported' : 'edited',
            ...totalsFor(body.p_items, body.p_discount, body.p_vat_rate),
          })
          return json(route, inv)
        }
        case 'mark_invoice_exported': {
          const inv = db.invoices.find((i) => i.id === body.p_id)
          if (!inv) return postgrestError(route, 'P0002', 'Invoice not found', 404)
          Object.assign(inv, { status: 'exported', exported_at: new Date().toISOString() })
          return json(route, inv)
        }
        case 'set_monthly_target': {
          const cur = db.targets.find((t) => t.year === body.p_year && t.month === body.p_month)
          if (cur) cur.target_amount = body.p_amount
          else db.targets.push({ id: `t-${db.targets.length + 1}`, year: body.p_year, month: body.p_month, target_amount: body.p_amount })
          return json(route, {})
        }
        case 'import_products': {
          let created = 0, updated = 0
          for (const r of body.p_rows) {
            const ex = db.products.find((p) => p.sku === r.sku)
            if (ex) { updated++; Object.assign(ex, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== ''))) }
            else { created++; db.products.push(product(db.products.length + 1, r.sku, r.name_th || '', r.name_en || '', r.category || '', r.stock_qty ?? 0, r.min_stock ?? 0)) }
          }
          return json(route, { created, updated })
        }
        case 'import_sales':
          return json(route, { created: body.p_rows.length, updated: 0 })
        case 'import_invoices':
          return json(route, { created: body.p_rows.length, updated: 0, skipped_edited: 0 })
        case 'record_import':
          db.logs.unshift({ id: `l-${db.logs.length + 1}`, kind: body.p_kind, file_name: body.p_file_name, row_count: body.p_row_count, created_count: body.p_created, updated_count: body.p_updated, skipped_count: body.p_skipped, imported_by: db.email, note: body.p_note, created_at: new Date().toISOString() })
          return json(route, 'log-id')
        default:
          return postgrestError(route, '42883', `unknown rpc ${fn}`, 404)
      }
    }

    // ---- Tables ----
    const table = path.replace('/rest/v1/', '')
    const idEq = url.searchParams.get('id')?.replace(/^eq\./, '')
    switch (table) {
      case 'profiles':
        if (method === 'PATCH') {
          if (db.role !== 'admin') return json(route, [])
          const row = db.profiles.find((p) => p.id === idEq)
          if (row) Object.assign(row, body)
          return json(route, row ? [row] : [])
        }
        return asSingle(route, idEq ? db.profiles.filter((p) => p.id === idEq) : db.role === 'admin' ? db.profiles : [me], wantsObject)
      case 'products':
        if (method === 'PATCH') {
          if (db.role !== 'admin') return json(route, [])
          const row = db.products.find((p) => p.id === idEq)
          if (row) {
            Object.assign(row, body)
            row.restock_qty = Math.max(0, row.min_stock - row.stock_qty)
            row.stock_state = row.min_stock <= 0 ? 'ok' : row.stock_qty <= row.min_stock * 0.2 ? 'critical' : row.stock_qty <= row.min_stock ? 'low' : 'ok'
          }
          return json(route, row ? [row] : [])
        }
        return json(route, db.products)
      case 'product_stock_history':
        return json(route, [])
      case 'tax_invoices': {
        const status = url.searchParams.get('status')?.replace(/^eq\./, '')
        let rows = idEq ? db.invoices.filter((i) => i.id === idEq) : db.invoices.filter((i) => !status || i.status === status)
        const or = url.searchParams.get('or')
        if (or) {
          const m = or.match(/ilike\."%(.*?)%"/)
          const q = (m?.[1] ?? '').toLowerCase()
          rows = rows.filter((i) => i.doc_no.toLowerCase().includes(q) || i.customer_name.toLowerCase().includes(q))
        }
        return asSingle(route, rows, wantsObject)
      }
      case 'company_profile':
        if (method === 'POST') { Object.assign(db.company, body); return json(route, db.company) }
        return asSingle(route, [db.company], wantsObject)
      case 'monthly_targets':
        if (method === 'DELETE') {
          if (db.role !== 'admin') return json(route, [])
          const i = db.targets.findIndex((t) => t.id === idEq)
          const removed = i >= 0 ? db.targets.splice(i, 1) : []
          return json(route, removed)
        }
        return json(route, db.targets.filter((t) => !url.searchParams.get('year') || String(t.year) === url.searchParams.get('year')!.replace(/^eq\./, '')))
      case 'sync_logs':
        return json(route, db.logs)
      default:
        return postgrestError(route, '42P01', `unknown table ${table}`, 404)
    }
  })
}

/** Sign in through the real login form. */
export async function signIn(page: Page, email = 'owner@ole.test', password = 'correct-password') {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

