// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asAnon, asUser, createTestDb, expectDbError } from './harness'

let db: PGlite
let admin: string
let staff: string

const productRow = (sku: string, extra: Record<string, unknown> = {}) => ({
  sku,
  name_th: `สินค้า ${sku}`,
  stock_qty: 10,
  min_stock: 20,
  unit_price: 100,
  ...extra,
})

beforeAll(async () => {
  db = await createTestDb()
  admin = await addUser(db, 'owner@ole.test', 'Owner')
  staff = await addUser(db, 'staff@ole.test', 'Staff')
})
afterAll(async () => {
  await db.close()
})

describe('roles and profiles', () => {
  it('makes the first user admin and later users staff', async () => {
    const r = await db.query<{ email: string; role: string }>('select email, role from public.profiles order by created_at')
    expect(r.rows).toEqual([
      { email: 'owner@ole.test', role: 'admin' },
      { email: 'staff@ole.test', role: 'user' },
    ])
  })

  it('lets staff see only their own profile, admin see all', async () => {
    const asStaff = await asUser(db, staff, () => db.query('select id from public.profiles'))
    expect(asStaff.rows).toHaveLength(1)
    const asAdmin = await asUser(db, admin, () => db.query('select id from public.profiles'))
    expect(asAdmin.rows).toHaveLength(2)
  })

  it('stops staff promoting themselves', async () => {
    const msg = await expectDbError(() =>
      asUser(db, staff, () => db.query(`update public.profiles set role = 'admin' where id = $1`, [staff])),
    )
    expect(msg).toMatch(/Only owners and admins/)
    const r = await db.query<{ role: string }>('select role from public.profiles where id = $1', [staff])
    expect(r.rows[0]!.role).toBe('user')
  })

  it('does not let staff change their email either', async () => {
    await expectDbError(() =>
      asUser(db, staff, () => db.query(`update public.profiles set email = 'x@y.z' where id = $1`, [staff])),
    )
  })

  it('stops anyone demoting the last admin', async () => {
    const msg = await expectDbError(() =>
      asUser(db, admin, () => db.query(`update public.profiles set role = 'user' where id = $1`, [admin])),
    )
    expect(msg).toMatch(/At least one owner/)
  })

  it('lets admin change another user role and records it in the audit log', async () => {
    await asUser(db, admin, () => db.query(`update public.profiles set role = 'admin' where id = $1`, [staff]))
    await asUser(db, admin, () => db.query(`update public.profiles set role = 'user' where id = $1`, [staff]))
    const audit = await asUser(db, admin, () => db.query(`select 1 from public.audit_logs where table_name = 'profiles'`))
    expect(audit.rows.length).toBeGreaterThanOrEqual(2)
  })
})

describe('anonymous and staff access is denied', () => {
  it('anon cannot read any table', async () => {
    for (const t of ['products', 'sales', 'tax_invoices', 'company_profile', 'profiles']) {
      const msg = await expectDbError(() => asAnon(db, () => db.query(`select * from public.${t}`)))
      expect(msg).toMatch(/permission denied/)
    }
  })

  it('anon cannot call RPCs', async () => {
    const msg = await expectDbError(() => asAnon(db, () => db.query(`select public.dashboard_summary(2026, 1)`)))
    expect(msg).toMatch(/permission denied/)
  })

  it('staff cannot import, edit settings or write directly', async () => {
    const rows = JSON.stringify([productRow('X1')])
    const m1 = await expectDbError(() => asUser(db, staff, () => db.query('select public.import_products($1::jsonb, $2)', [rows, 'f.csv'])))
    expect(m1).toMatch(/Only owners and admins/)
    const m2 = await expectDbError(() => asUser(db, staff, () => db.query(`select public.set_monthly_target(2026, 1, 1000)`)))
    expect(m2).toMatch(/Only owners and admins/)
    const m3 = await expectDbError(() => asUser(db, staff, () => db.query(`insert into public.sales (line_key, bill_no, sale_date, sku, qty) values ('a','b','2026-01-01','s',1)`)))
    expect(m3).toMatch(/permission denied/)
    const m4 = await expectDbError(() => asUser(db, staff, () => db.query(`select public.record_import('products','f',1,1,0,0,'')`)))
    expect(m4).toMatch(/Only owners and admins/)
  })

  it('staff updates to company_profile affect no rows', async () => {
    const r = await asUser(db, staff, () => db.query(`update public.company_profile set vat_rate = 99 where id = 1`))
    expect(r.affectedRows).toBe(0)
    const c = await db.query<{ vat_rate: string }>('select vat_rate from public.company_profile')
    expect(Number(c.rows[0]!.vat_rate)).toBe(7)
  })

  it('staff cannot read the audit log', async () => {
    const r = await asUser(db, staff, () => db.query('select * from public.audit_logs'))
    expect(r.rows).toHaveLength(0)
  })

  it('staff can read business data', async () => {
    const r = await asUser(db, staff, () => db.query('select count(*)::int as n from public.company_profile'))
    expect(r.rows[0]).toEqual({ n: 1 })
  })
})

describe('products', () => {
  it('derives stock_state and restock_qty (critical <= 20% of reorder point)', async () => {
    const rows = [
      productRow('P-OK', { stock_qty: 50, min_stock: 20 }),
      productRow('P-LOW', { stock_qty: 15, min_stock: 20 }),
      productRow('P-CRIT', { stock_qty: 4, min_stock: 20 }),
      productRow('P-EDGE', { stock_qty: 4.5, min_stock: 20 }),
      productRow('P-NOMIN', { stock_qty: 0, min_stock: 0 }),
    ]
    const r = await asUser(db, admin, () => db.query(`select public.import_products($1::jsonb, 'prod.csv') as r`, [JSON.stringify(rows)]))
    expect((r.rows[0] as { r: { created: number } }).r.created).toBe(5)
    const s = await db.query<{ sku: string; stock_state: string; restock_qty: string }>(
      `select sku, stock_state, restock_qty from public.products order by sku`,
    )
    const by = Object.fromEntries(s.rows.map((x) => [x.sku, x]))
    expect(by['P-OK']!.stock_state).toBe('ok')
    expect(by['P-LOW']!.stock_state).toBe('low')
    expect(by['P-CRIT']!.stock_state).toBe('critical')
    expect(by['P-EDGE']!.stock_state).toBe('low')
    expect(by['P-NOMIN']!.stock_state).toBe('ok')
    expect(Number(by['P-LOW']!.restock_qty)).toBe(5)
    expect(Number(by['P-OK']!.restock_qty)).toBe(0)
  })

  it('re-import updates in place, keeps unmapped fields and logs stock history', async () => {
    const rows = [{ sku: 'P-LOW', stock_qty: 30 }]
    const r = await asUser(db, admin, () => db.query(`select public.import_products($1::jsonb, 'again.csv') as r`, [JSON.stringify(rows)]))
    expect((r.rows[0] as { r: { created: number; updated: number } }).r).toEqual({ created: 0, updated: 1 })
    const p = await db.query<{ name_th: string; stock_qty: string; min_stock: string; stock_state: string }>(
      `select name_th, stock_qty, min_stock, stock_state from public.products where sku = 'P-LOW'`,
    )
    expect(p.rows[0]!.name_th).toBe('สินค้า P-LOW') // not wiped by the missing column
    expect(Number(p.rows[0]!.min_stock)).toBe(20)
    expect(p.rows[0]!.stock_state).toBe('ok')
    const h = await db.query<{ source: string; delta: string }>(
      `select source, delta from public.product_stock_history where sku = 'P-LOW' order by id`,
    )
    expect(h.rows.map((x) => x.source)).toEqual(['initial', 'import'])
    expect(Number(h.rows[1]!.delta)).toBe(15)
  })

  it('collapses duplicate SKUs inside one payload (last wins)', async () => {
    const rows = [{ sku: 'DUP', stock_qty: 1 }, { sku: 'DUP', stock_qty: 9 }]
    await asUser(db, admin, () => db.query(`select public.import_products($1::jsonb, '')`, [JSON.stringify(rows)]))
    const r = await db.query<{ stock_qty: string }>(`select stock_qty from public.products where sku = 'DUP'`)
    expect(Number(r.rows[0]!.stock_qty)).toBe(9)
  })

  it('lets admin edit a product, not staff; stock edits are logged as manual', async () => {
    await asUser(db, admin, () => db.query(`update public.products set stock_qty = 7 where sku = 'P-OK'`))
    const h = await db.query<{ source: string }>(`select source from public.product_stock_history where sku = 'P-OK' order by id desc limit 1`)
    expect(h.rows[0]!.source).toBe('manual')
    const r = await asUser(db, staff, () => db.query(`update public.products set stock_qty = 1 where sku = 'P-OK'`))
    expect(r.affectedRows).toBe(0)
  })

  it('refuses writes to derived columns', async () => {
    const msg = await expectDbError(() =>
      asUser(db, admin, () => db.query(`update public.products set stock_state = 'ok' where sku = 'P-OK'`)),
    )
    expect(msg).toMatch(/DEFAULT|permission denied/)
  })

  it('treats % and _ in searches literally', async () => {
    const all = await asUser(db, staff, () => db.query(`select * from public.products_filtered('', '', 'all')`))
    const pct = await asUser(db, staff, () => db.query(`select * from public.products_filtered('%', '', 'all')`))
    expect(all.rows.length).toBeGreaterThan(0)
    expect(pct.rows).toHaveLength(0)
    const found = await asUser(db, staff, () => db.query(`select * from public.products_filtered('p-crit', '', 'all')`))
    expect(found.rows).toHaveLength(1)
  })

  it('filters by stock state', async () => {
    const alerts = await asUser(db, staff, () => db.query<{ sku: string }>(`select sku from public.products_filtered('', '', 'alerts')`))
    expect(alerts.rows.map((r) => r.sku).sort()).toEqual(['P-CRIT', 'P-EDGE', 'P-OK']) // P-OK was edited down to 7 above
  })
})

describe('sales import and reporting', () => {
  const sale = (bill: string, sku: string, qty: number, amount: number, date: string, line_no = 1, customer = 'ACME') => ({
    bill_no: bill, sku, qty, amount, sale_date: date, line_no, customer_name: customer, unit_price: amount / qty,
  })

  it('imports lines and is idempotent when the same file is imported again', async () => {
    const rows = [
      sale('B1', 'P-OK', 2, 200, '2026-10-02'),
      sale('B1', 'P-OK', 1, 100, '2026-10-02', 2),
      sale('B2', 'P-LOW', 5, 500, '2026-10-05', 1, 'Beta'),
      sale('B3', 'P-LOW', 1, 100, '2026-09-20', 1, 'Beta'),
    ]
    const first = await asUser(db, admin, () => db.query(`select public.import_sales($1::jsonb, 's.csv') as r`, [JSON.stringify(rows)]))
    expect((first.rows[0] as { r: { created: number } }).r.created).toBe(4)
    const second = await asUser(db, admin, () => db.query(`select public.import_sales($1::jsonb, 's.csv') as r`, [JSON.stringify(rows)]))
    expect((second.rows[0] as { r: { created: number; updated: number } }).r).toEqual({ created: 0, updated: 4 })
    const n = await db.query<{ n: number }>('select count(*)::int as n from public.sales')
    expect(n.rows[0]!.n).toBe(4)
  })

  it('counts bills as distinct bill numbers and filters by date and search', async () => {
    const all = await asUser(db, staff, () => db.query<{ s: Record<string, number> }>(`select public.sales_summary(null, null, '') as s`))
    expect(all.rows[0]!.s).toMatchObject({ revenue: 900, units: 9, bills: 3, lines: 4 })
    const oct = await asUser(db, staff, () => db.query<{ s: Record<string, number> }>(`select public.sales_summary('2026-10-01', '2026-10-31', '') as s`))
    expect(oct.rows[0]!.s).toMatchObject({ revenue: 800, bills: 2 })
    const beta = await asUser(db, staff, () => db.query<{ s: Record<string, number> }>(`select public.sales_summary(null, null, 'beta') as s`))
    expect(beta.rows[0]!.s).toMatchObject({ revenue: 600, bills: 2 })
  })

  it('groups by customer with distinct bills', async () => {
    const r = await asUser(db, staff, () =>
      db.query<{ customer_name: string; bills: string; revenue: string }>(`select * from public.sales_by_customer(null, null, 40)`),
    )
    expect(r.rows.map((x) => [x.customer_name, Number(x.bills), Number(x.revenue)])).toEqual([
      ['Beta', 2, 600],
      ['ACME', 1, 300],
    ])
  })

  it('builds the dashboard from real rows', async () => {
    await asUser(db, admin, () => db.query(`select public.set_monthly_target(2026, 10, 5000)`))
    await asUser(db, admin, () => db.query(`select public.record_import('sales', 's.csv', 4, 4, 0, 0, '')`))
    const r = await asUser(db, staff, () => db.query<{ d: any }>(`select public.dashboard_summary(2026, 10) as d`))
    const d = r.rows[0]!.d
    expect(d.revenue).toBe(800)
    expect(d.units).toBe(8)
    expect(d.bills).toBe(2)
    expect(d.trend.map((t: any) => t.month)).toEqual(['2026-09', '2026-10'])
    expect(d.topSkus[0].sku).toBe('P-LOW')
    expect(d.target.target_amount).toBe(5000)
    expect(d.alertCount).toBe(3)
    expect(d.lastLog.kind).toBe('sales')
  })

  it('returns an empty but valid dashboard for a month with no data', async () => {
    const r = await asUser(db, staff, () => db.query<{ d: any }>(`select public.dashboard_summary(2020, 1) as d`))
    expect(r.rows[0]!.d).toMatchObject({ revenue: 0, units: 0, bills: 0, target: null })
  })
})

describe('tax invoices', () => {
  const inv = (doc: string) => ({
    doc_no: doc, doc_date: '2026-10-03', customer_name: 'ACME', vat_rate: 7,
    items: [
      { sku: 'P-OK', description: 'Honey', qty: 2, unit: 'jar', unit_price: 100, amount: 200 },
      { sku: 'P-LOW', description: 'Syrup', qty: 1, unit: 'btl', unit_price: 50, amount: 50 },
    ],
  })

  it('computes totals on the server from the items', async () => {
    await asUser(db, admin, () => db.query(`select public.import_invoices($1::jsonb, 'i.csv')`, [JSON.stringify([inv('INV-1'), inv('INV-2')])]))
    const r = await db.query<{ subtotal: string; vat_amount: string; total: string; status: string }>(
      `select subtotal, vat_amount, total, status from public.tax_invoices where doc_no = 'INV-1'`,
    )
    expect(r.rows[0]).toEqual({ subtotal: '250.00', vat_amount: '17.50', total: '267.50', status: 'imported' })
  })

  it('save_invoice recalculates, marks edited, and ignores client-supplied totals', async () => {
    const id = (await db.query<{ id: string }>(`select id from public.tax_invoices where doc_no = 'INV-1'`)).rows[0]!.id
    const items = [{ sku: 'P-OK', description: 'Honey', qty: 1, unit: 'jar', unit_price: 100, amount: 100 }]
    const r = await asUser(db, admin, () =>
      db.query<{ s: any }>(
        `select to_jsonb(public.save_invoice($1, 'ACME 2', '123', 'addr', '00000', '2026-10-04', $2::jsonb, 10, 7, 'n')) as s`,
        [id, JSON.stringify(items)],
      ),
    )
    const s = r.rows[0]!.s
    expect(s.status).toBe('edited')
    expect(s.subtotal).toBe(100)
    expect(s.vat_amount).toBe(6.3)
    expect(s.total).toBe(96.3)
    expect(s.edited_by).toBe('owner@ole.test')
  })

  it('does not let staff save or export invoices', async () => {
    const id = (await db.query<{ id: string }>(`select id from public.tax_invoices where doc_no = 'INV-2'`)).rows[0]!.id
    const m = await expectDbError(() => asUser(db, staff, () => db.query(`select public.mark_invoice_exported($1)`, [id])))
    expect(m).toMatch(/Only owners and admins/)
    const m2 = await expectDbError(() => asUser(db, staff, () => db.query(`update public.tax_invoices set total = 1 where id = $1`, [id])))
    expect(m2).toMatch(/permission denied/)
  })

  it('export keeps status exported even after later edits', async () => {
    const id = (await db.query<{ id: string }>(`select id from public.tax_invoices where doc_no = 'INV-2'`)).rows[0]!.id
    const ex = await asUser(db, admin, () => db.query<{ s: any }>(`select to_jsonb(public.mark_invoice_exported($1)) as s`, [id]))
    expect(ex.rows[0]!.s.status).toBe('exported')
    expect(ex.rows[0]!.s.exported_at).not.toBeNull()
    const ed = await asUser(db, admin, () =>
      db.query<{ s: any }>(`select to_jsonb(public.save_invoice($1,'x','','','','2026-10-03','[]'::jsonb,0,7,'')) as s`, [id]),
    )
    expect(ed.rows[0]!.s.status).toBe('exported')
  })

  it('re-import does not overwrite corrected or exported invoices', async () => {
    const r = await asUser(db, admin, () =>
      db.query<{ r: any }>(`select public.import_invoices($1::jsonb, 'i2.csv') as r`, [JSON.stringify([inv('INV-1'), inv('INV-2'), inv('INV-3')])]),
    )
    // sales_lines mirrors the FINAL items of all three docs: INV-1 keeps its corrected single
    // item, INV-2 was re-saved with no items, INV-3 is new with its two file items
    expect(r.rows[0]!.r).toEqual({ created: 1, updated: 0, skipped_edited: 2, sales_lines: 3 })
    const c = await db.query<{ customer_name: string }>(`select customer_name from public.tax_invoices where doc_no = 'INV-1'`)
    expect(c.rows[0]!.customer_name).toBe('ACME 2')
  })

  it('rejects malformed item payloads', async () => {
    const msg = await expectDbError(() =>
      asUser(db, admin, () => db.query(`select public.import_invoices('{"a":1}'::jsonb, '')`)),
    )
    expect(msg).toMatch(/array/)
  })
})

describe('company settings and targets', () => {
  it('lets admin update company details and delete targets', async () => {
    await asUser(db, admin, () => db.query(`update public.company_profile set tax_id = '0105560000000', vat_rate = 7 where id = 1`))
    const t = await db.query<{ id: string }>(`select id from public.monthly_targets limit 1`)
    const r = await asUser(db, admin, () => db.query(`delete from public.monthly_targets where id = $1`, [t.rows[0]!.id]))
    expect(r.affectedRows).toBe(1)
  })

  it('rejects a second company_profile row', async () => {
    await expectDbError(() => asUser(db, admin, () => db.query(`insert into public.company_profile (id) values (2)`)))
  })

  it('refuses invalid month values', async () => {
    await expectDbError(() => asUser(db, admin, () => db.query(`select public.set_monthly_target(2026, 13, 100)`)))
  })
})

