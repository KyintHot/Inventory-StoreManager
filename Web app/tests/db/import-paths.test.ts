// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createTestDb } from './harness'

let db: PGlite
let admin: string
let staff: string

afterAll(async () => {
  await db.close()
})

beforeAll(async () => {
  db = await createTestDb()
  // the first user is auto-promoted to admin by the handle_new_user trigger
  admin = await addUser(db, 'admin@test.local', 'Admin')
  staff = await addUser(db, 'staff@test.local', 'Staff')
  // products must exist first so sales/invoices reference real SKUs
  const products = [
    { sku: 'HW-001', name_th: 'สกรู', unit_price: 120, stock_qty: 40, min_stock: 10 },
    { sku: 'HW-002', name_th: 'ไม้บรรทัด', unit_price: 85, stock_qty: 3, min_stock: 15 },
    { sku: 'HW-003', name_th: 'สว่าน', unit_price: 1450, stock_qty: 6, min_stock: 8 },
    { sku: 'HW-005', name_th: 'ท่อ PVC', unit_price: 150, stock_qty: 0, min_stock: 20 },
    { sku: 'HW-007', name_th: 'บันได', unit_price: 1890, stock_qty: 5, min_stock: 6 },
  ]
  await asUser(db, admin, () => db.query(`select public.import_products($1::jsonb, 'seed.csv')`, [JSON.stringify(products)]))
})

/** Exactly the record shape src/utils/importMapping.ts buildSales() emits. */
const saleRows = [
  { bill_no: 'INV-1001', sale_date: '2026-10-01', sku: 'HW-001', product_name: 'สกรูเกลียวปล่อย 2"', qty: 10, unit: 'box', unit_price: 120, amount: 1200, customer_name: 'ร้านช่างชาย', line_no: 1 },
  { bill_no: 'INV-1001', sale_date: '2026-10-01', sku: 'HW-002', product_name: 'Steel ruler 12 inch', qty: 2, unit: 'pcs', unit_price: 85, amount: 170, customer_name: 'ร้านช่างชาย', line_no: 1 },
  { bill_no: 'INV-1002', sale_date: '2026-10-05', sku: 'HW-003', product_name: 'Electric drill 650W', qty: 1, unit: 'pcs', unit_price: 1450, amount: 1450, customer_name: 'นายสมชาย', line_no: 1 },
  { bill_no: 'INV-1003', sale_date: '2026-10-12', sku: 'HW-005', product_name: 'PVC pipe 4 inch', qty: 25, unit: 'pcs', unit_price: 150, amount: 3750, customer_name: 'บริษัท ทดสอบ จำกัด', line_no: 1 },
  { bill_no: 'INV-1003', sale_date: '2026-10-12', sku: 'HW-007', product_name: 'Aluminium ladder 7 step', qty: 1, unit: 'pcs', unit_price: 1890, amount: 1890, customer_name: 'บริษัท ทดสอบ จำกัด', line_no: 1 },
]

/** Exactly the record shape buildInvoices() emits: one record per doc, items nested. */
const invoiceRows = [
  {
    doc_no: 'TAX-0001', doc_date: '2026-10-01', customer_name: 'ร้านช่างชาย',
    customer_tax_id: '0105555123456', customer_address: '123 ถ.สุขุมวิท กรุงเทพ', customer_branch: 'สำนักงานใหญ่', vat_rate: 7,
    items: [
      { sku: 'HW-001', description: 'สกรูเกลียวปล่อย 2"', qty: 10, unit: 'box', unit_price: 120, amount: 1200 },
      { sku: 'HW-002', description: 'Steel ruler 12 inch', qty: 2, unit: 'pcs', unit_price: 85, amount: 170 },
    ],
  },
  {
    doc_no: 'TAX-0002', doc_date: '2026-10-12', customer_name: 'บริษัท ทดสอบ จำกัด',
    customer_tax_id: '0105559876543', customer_address: '456 ถ.รัชดาภิเษก กรุงเทพ', customer_branch: 'สาขา ปทุมวัน', vat_rate: 7,
    items: [
      { sku: 'HW-005', description: 'PVC pipe 4 inch', qty: 25, unit: 'pcs', unit_price: 150, amount: 3750 },
      { sku: 'HW-007', description: 'Aluminium ladder 7 step', qty: 1, unit: 'pcs', unit_price: 1890, amount: 1890 },
    ],
  },
]

describe('import_sales', () => {
  it('creates the sale lines from a Comet5 export', async () => {
    const r = await asUser(db, admin, () =>
      db.query(`select public.import_sales($1::jsonb, 'test-sales.csv') as r`, [JSON.stringify(saleRows)]))
    expect((r.rows[0] as { r: { created: number; updated: number } }).r).toEqual({ created: 5, updated: 0 })

    const s = await db.query<{ bill_no: string; sku: string; qty: string; amount: string; line_key: string }>(
      `select bill_no, sku, qty, amount, line_key from public.sales order by bill_no, sku`)
    expect(s.rows).toHaveLength(5)
    expect(s.rows.map((x) => x.bill_no)).toEqual(['INV-1001', 'INV-1001', 'INV-1002', 'INV-1003', 'INV-1003'])
    expect(s.rows[0]!.line_key).toBe('INV-1001|HW-001|1') // matches client's bill|sku|line_no
    expect(Number(s.rows[3]!.qty)).toBe(25)
  })

  it('is idempotent — re-importing the same file updates instead of duplicating', async () => {
    const r = await asUser(db, admin, () =>
      db.query(`select public.import_sales($1::jsonb, 'test-sales.csv') as r`, [JSON.stringify(saleRows)]))
    expect((r.rows[0] as { r: { created: number; updated: number } }).r).toEqual({ created: 0, updated: 5 })
    const c = await db.query<{ n: string }>(`select count(*)::text as n from public.sales`)
    expect(c.rows[0]!.n).toBe('5')
  })

  it('staff cannot import sales', async () => {
    const r = await asUser(db, staff, () =>
      db.query(`select public.import_sales($1::jsonb, 'x.csv')`, [JSON.stringify(saleRows)]))
      .catch((e: Error) => e.message)
    expect(r).toMatch(/Only owners and admins/)
  })
})

describe('import_invoices', () => {
  it('creates tax invoices with their line items intact', async () => {
    const r = await asUser(db, admin, () =>
      db.query(`select public.import_invoices($1::jsonb, 'test-invoices.csv') as r`, [JSON.stringify(invoiceRows)]))
    expect((r.rows[0] as { r: { created: number; updated: number; skipped_edited: number; sales_lines: number } }).r)
      .toEqual({ created: 2, updated: 0, skipped_edited: 0, sales_lines: 4 })

    const inv = await db.query<{ doc_no: string; items: { sku: string }[]; status: string; customer_tax_id: string }>(
      `select doc_no, items, status, customer_tax_id from public.tax_invoices order by doc_no`)
    expect(inv.rows).toHaveLength(2)
    expect(inv.rows[0]!.items.map((i) => i.sku)).toEqual(['HW-001', 'HW-002'])
    expect(inv.rows[1]!.customer_tax_id).toBe('0105559876543')
    expect(inv.rows[0]!.status).toBe('imported')
  })

  it('re-import updates imported invoices but never overwrites corrected ones', async () => {
    // an invoice the user has corrected/issued must be protected from a re-import.
    // (set up as superuser: tax_invoices grants SELECT only, so writes go via RPCs — by design)
    await db.query(`update public.tax_invoices set status = 'exported' where doc_no = 'TAX-0002'`)
    const r = await asUser(db, admin, () =>
      db.query(`select public.import_invoices($1::jsonb, 'test-invoices.csv') as r`, [JSON.stringify(invoiceRows)]))
    const out = (r.rows[0] as { r: { created: number; updated: number; skipped_edited: number; sales_lines: number } }).r
    expect(out).toEqual({ created: 0, updated: 1, skipped_edited: 1, sales_lines: 4 })

    const inv = await db.query<{ doc_no: string; status: string }>(
      `select doc_no, status from public.tax_invoices order by doc_no`)
    expect(inv.rows.map((x) => x.status)).toEqual(['imported', 'exported']) // TAX-0002 untouched
  })

  it('staff cannot import invoices', async () => {
    const r = await asUser(db, staff, () =>
      db.query(`select public.import_invoices($1::jsonb, 'x.csv')`, [JSON.stringify(invoiceRows)]))
      .catch((e: Error) => e.message)
    expect(r).toMatch(/Only owners and admins/)
  })
})

// Imported invoice items must also reach public.sales — revenue, the target bar, the trend
// chart and top sellers all read sales, so invoice imports feed every money view.
describe('invoice items feeding sales (all charts)', () => {
  it('mirrors invoice items into sales with import_sales-compatible line keys', async () => {
    const r = await asUser(db, admin, () =>
      db.query(`select public.import_invoices($1::jsonb, 'derived.csv') as r`, [JSON.stringify(invoiceRows)]))
    const out = (r.rows[0] as { r: { created: number; updated: number; skipped_edited: number; sales_lines: number } }).r
    // TAX-0001 is still 'imported' → updated; TAX-0002 was exported earlier → protected
    expect(out).toEqual({ created: 0, updated: 1, skipped_edited: 1, sales_lines: 4 })

    const s = await db.query<{ line_key: string; qty: string; amount: string }>(
      `select line_key, qty, amount from public.sales where bill_no like 'TAX-%' order by line_key`)
    expect(s.rows.map((x) => x.line_key)).toEqual([
      'TAX-0001|HW-001|1',
      'TAX-0001|HW-002|1',
      'TAX-0002|HW-005|1',
      'TAX-0002|HW-007|1',
    ])
    const total = s.rows.reduce((sum, x) => sum + Number(x.amount), 0)
    expect(total).toBe(1200 + 170 + 3750 + 1890)
  })

  it('re-importing the same invoices does not duplicate or drift the sales rows', async () => {
    const r = await asUser(db, admin, () =>
      db.query(`select public.import_invoices($1::jsonb, 'derived.csv') as r`, [JSON.stringify(invoiceRows)]))
    expect((r.rows[0] as { r: { sales_lines: number } }).r.sales_lines).toBe(4)
    const c = await db.query<{ n: string }>(`select count(*)::text as n from public.sales where bill_no like 'TAX-%'`)
    expect(c.rows[0]!.n).toBe('4')
  })

  it('the same SKU twice on one invoice gets distinct line keys', async () => {
    const dup = [{
      doc_no: 'TAX-0003', doc_date: '2026-10-14', customer_name: 'ร้านซ้ำ', vat_rate: 7,
      items: [
        { sku: 'HW-001', description: 'สกรู', qty: 1, unit: 'pcs', unit_price: 120, amount: 120 },
        { sku: 'HW-001', description: 'สกรู', qty: 2, unit: 'pcs', unit_price: 120, amount: 240 },
      ],
    }]
    await asUser(db, admin, () =>
      db.query(`select public.import_invoices($1::jsonb, 'dup.csv')`, [JSON.stringify(dup)]))
    const s = await db.query<{ line_key: string }>(
      `select line_key from public.sales where bill_no = 'TAX-0003' order by line_key`)
    expect(s.rows.map((x) => x.line_key)).toEqual(['TAX-0003|HW-001|1', 'TAX-0003|HW-001|2'])
  })

  it('correcting an invoice re-mirrors its sales immediately and drops removed lines', async () => {
    const id = await db.query<{ id: string }>(`select id from public.tax_invoices where doc_no = 'TAX-0001'`)
    const corrected = [
      { sku: 'HW-001', description: 'สกรู', qty: 3, unit: 'box', unit_price: 120, amount: 360 },
    ]
    await asUser(db, admin, () => db.query(
      `select public.save_invoice($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::date, $7::jsonb, 0, 7, '')`,
      [id.rows[0]!.id, 'ร้านช่างชาย', '0105555123456', '123 ถ.สุขุมวิท กรุงเทพ', 'สำนักงานใหญ่',
       '2026-10-01', JSON.stringify(corrected)],
    ))

    const s = await db.query<{ line_key: string; qty: string; amount: string; customer_name: string }>(
      `select line_key, qty, amount, customer_name from public.sales where bill_no = 'TAX-0001'`)
    expect(s.rows).toHaveLength(1) // the HW-002 line disappears with the correction
    expect(s.rows[0]!.line_key).toBe('TAX-0001|HW-001|1')
    expect(Number(s.rows[0]!.qty)).toBe(3)
    expect(Number(s.rows[0]!.amount)).toBe(360)
    expect(s.rows[0]!.customer_name).toBe('ร้านช่างชาย')

    const st = await db.query<{ status: string }>(`select status from public.tax_invoices where doc_no = 'TAX-0001'`)
    expect(st.rows[0]!.status).toBe('edited')

    // and a re-import still cannot overwrite the correction
    const r = await asUser(db, admin, () =>
      db.query(`select public.import_invoices($1::jsonb, 'derived.csv') as r`, [JSON.stringify(invoiceRows)]))
    expect((r.rows[0] as { r: { created: number; updated: number; skipped_edited: number; sales_lines: number } }).r)
      .toEqual({ created: 0, updated: 0, skipped_edited: 2, sales_lines: 3 })
    const after = await db.query<{ n: string }>(`select count(*)::text as n from public.sales where bill_no = 'TAX-0001'`)
    expect(after.rows[0]!.n).toBe('1')
  })
})
