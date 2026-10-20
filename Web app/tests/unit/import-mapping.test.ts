import { describe, expect, it } from 'vitest'
import { FIELD_SPECS, autoMap, buildInvoices, buildSales, detectImportKind, kindFit } from '@/utils/importMapping'

const SALES_CSV = `เลขที่บิล,วันที่,รหัสสินค้า,ชื่อสินค้า,จำนวน,หน่วย,ราคาต่อหน่วย,มูลค่า,ลูกค้า
INV-1001,2026-10-01,HW-001,สกรูเกลียวปล่อย 2",10,box,120.00,1200.00,ร้านช่างชาย
INV-1001,2026-10-01,HW-002,Steel ruler 12 inch,2,pcs,85.00,170.00,ร้านช่างชาย
INV-1002,2026-10-05,HW-003,Electric drill 650W,1,pcs,1450.00,1450.00,นายสมชาย
INV-1003,2026-10-12,HW-005,PVC pipe 4 inch,25,pcs,150.00,3750.00,บริษัท ทดสอบ จำกัด
INV-1003,2026-10-12,HW-007,Aluminium ladder 7 step,1,pcs,1890.00,1890.00,บริษัท ทดสอบ จำกัด
INV-1003,2026-10-12,HW-007,Aluminium ladder 7 step,1,pcs,1890.00,1890.00,บริษัท ทดสอบ จำกัด`

const INVOICES_CSV = `เลขที่ใบกำกับภาษี,วันที่,ลูกค้า,เลขประจำตัวผู้เสียภาษี,ที่อยู่,สาขา,รหัสสินค้า,รายการ,จำนวน,หน่วย,ราคาต่อหน่วย,จำนวนเงิน
TAX-0001,2026-10-01,ร้านช่างชาย,0105555123456,123 ถ.สุขุมวิท กรุงเทพ,สำนักงานใหญ่,HW-001,สกรูเกลียวปล่อย 2",10,box,120.00,1200.00
TAX-0001,2026-10-01,ร้านช่างชาย,0105555123456,123 ถ.สุขุมวิท กรุงเทพ,สำนักงานใหญ่,HW-002,Steel ruler 12 inch,2,pcs,85.00,170.00
TAX-0002,2026-10-12,บริษัท ทดสอบ จำกัด,0105559876543,456 ถ.รัชดาภิเษก กรุงเทพ,สาขา ปทุมวัน,HW-005,PVC pipe 4 inch,25,pcs,150.00,3750.00
TAX-0002,2026-10-12,บริษัท ทดสอบ จำกัด,0105559876543,456 ถ.รัชดาภิเษก กรุงเทพ,สาขา ปทุมวัน,HW-007,Aluminium ladder 7 step,1,pcs,1890.00,1890.00`

const parse = (csv: string): string[][] => csv.trim().split('\n').map((l) => l.split(','))

const PRODUCTS_CSV = `รหัสสินค้า,ชื่อสินค้า,หมวดหมู่,หน่วย,ราคาขาย,ราคาทุน,คงเหลือ,จุดสั่งซื้อ,ผู้จำหน่าย
HNY-001,น้ำผึ้งดอกลำไย,น้ำผึ้ง,ขวด,121,90,48,30,โรงงานแม่กลอง`

const productsHeaders = parse(PRODUCTS_CSV)[0]!
const salesHeaders = parse(SALES_CSV)[0]!
const invoiceHeaders = parse(INVOICES_CSV)[0]!

describe('import type detection from headers', () => {
  it('scores each type from the headers', () => {
    expect(kindFit('products', productsHeaders).fits).toBe(true)
    expect(kindFit('sales', salesHeaders).fits).toBe(true)
    expect(kindFit('invoices', invoiceHeaders).fits).toBe(true)
    // an invoice table reaches the sales type too (same item columns) and vice versa —
    // exact Thai aliases must decide, not the substring fallback
    expect(kindFit('sales', salesHeaders).score).toBeGreaterThan(kindFit('invoices', salesHeaders).score)
    expect(kindFit('invoices', invoiceHeaders).score).toBeGreaterThan(kindFit('sales', invoiceHeaders).score)
    // "products" is the greedy type: it fits a sales table as well, but scores worse
    expect(kindFit('products', salesHeaders).fits).toBe(true)
    expect(kindFit('sales', salesHeaders).score).toBeGreaterThan(kindFit('products', salesHeaders).score)
  })

  it('moves a sales or invoice export off "products" — it used to overwrite stock with sold quantities', () => {
    expect(detectImportKind(salesHeaders, 'products')).toBe('sales')
    expect(detectImportKind(invoiceHeaders, 'products')).toBe('invoices')
  })

  it('routes a products export back to "products" from any other selection', () => {
    expect(detectImportKind(productsHeaders, 'products')).toBe('products')
    expect(detectImportKind(productsHeaders, 'sales')).toBe('products')
    expect(detectImportKind(productsHeaders, 'invoices')).toBe('products')
  })

  it('keeps a fitting selection, but moves when another type fits strictly better', () => {
    expect(detectImportKind(salesHeaders, 'sales')).toBe('sales') // never flips sales to invoices
    expect(detectImportKind(invoiceHeaders, 'sales')).toBe('invoices')
  })

  it('keeps the selection when the headers fit nothing (the mapping screen explains why)', () => {
    expect(detectImportKind(['บริษัท ตัวอย่างฮาร์ดแวร์ จำกัด'], 'products')).toBe('products')
    expect(detectImportKind([], 'sales')).toBe('sales')
  })
})

describe('sales import path (Thai Comet5 headers)', () => {
  const headers = parse(SALES_CSV)[0]!
  const rows = parse(SALES_CSV).slice(1)
  const m = autoMap('sales', headers)

  it('auto-maps every required field', () => {
    for (const f of FIELD_SPECS.sales) {
      if (f.required) expect(m[f.key], `required field ${f.key}`).not.toBeNull()
    }
    expect(Object.values(m).filter((v) => v !== null).length).toBe(9)
  })

  it('builds 5 sale lines with the correct repeated-bill line numbering', () => {
    const { records, problems } = buildSales(rows, m)
    expect(problems).toEqual([])
    expect(records).toHaveLength(6)
    // line_no counts repeated (bill, SKU) pairs, so re-imports stay idempotent
    expect(records.map((r) => r.line_no)).toEqual([1, 1, 1, 1, 1, 2])
    expect(records.map((r) => r.bill_no)).toEqual(['INV-1001', 'INV-1001', 'INV-1002', 'INV-1003', 'INV-1003', 'INV-1003'])
  })

  it('parses dates, numbers and Thai customer names', () => {
    const { records } = buildSales(rows, m)
    expect(records[0]!.sale_date).toBe('2026-10-01')
    expect(records[3]!.customer_name).toBe('บริษัท ทดสอบ จำกัด')
    expect(records[2]!.amount).toBe(1450)
    expect(records.reduce((s, r) => s + r.amount, 0)).toBe(10350)
  })
})

describe('tax invoice import path (Thai Comet5 headers)', () => {
  const headers = parse(INVOICES_CSV)[0]!
  const rows = parse(INVOICES_CSV).slice(1)
  const m = autoMap('invoices', headers)

  it('auto-maps every required field', () => {
    for (const f of FIELD_SPECS.invoices) {
      if (f.required) expect(m[f.key], `required field ${f.key}`).not.toBeNull()
    }
  })

  it('groups 4 lines into 2 invoices with items attached', () => {
    const { records, problems } = buildInvoices(rows, m, 7)
    expect(problems).toEqual([])
    expect(records).toHaveLength(2)
    expect(records[0]!.doc_no).toBe('TAX-0001')
    expect(records[0]!.items).toHaveLength(2)
    expect(records[1]!.items).toHaveLength(2)
    expect(records[1]!.customer_tax_id).toBe('0105559876543')
    expect(records[0]!.vat_rate).toBe(7)
    expect(records[0]!.items[0]!.sku).toBe('HW-001')
  })
})
