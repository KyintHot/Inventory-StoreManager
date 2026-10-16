import { describe, expect, it } from 'vitest'
import { restockQty, stockState, targetProgress } from '@/utils/stock'
import { blankItem, computeInvoiceTotals, invoiceToExportRows, round2, updateItem } from '@/utils/invoice'
import { formatMoney, formatNumber, monthRange, toIsoDate } from '@/utils/format'
import {
  autoMap, buildInvoices, buildProducts, buildSales, chunk, parseDate, parseNumber,
} from '@/utils/importMapping'

describe('stock status', () => {
  it('is ok when the reorder point is zero or negative', () => {
    expect(stockState(0, 0)).toBe('ok')
    expect(stockState(5, -3)).toBe('ok')
  })
  it('flags critical at <= 20% of the reorder point and low up to the point', () => {
    expect(stockState(4, 20)).toBe('critical')
    expect(stockState(0, 20)).toBe('critical')
    expect(stockState(-2, 20)).toBe('critical')
    expect(stockState(4.5, 20)).toBe('low')
    expect(stockState(20, 20)).toBe('low')
    expect(stockState(20.001, 20)).toBe('ok')
  })
  it('coerces junk to zero', () => {
    expect(stockState('abc', 'xyz')).toBe('ok')
    expect(restockQty(undefined, 10)).toBe(10)
  })
  it('computes the quantity needed to get back to the reorder point', () => {
    expect(restockQty(15, 20)).toBe(5)
    expect(restockQty(25, 20)).toBe(0)
  })
  it('reports target progress without dividing by zero', () => {
    expect(targetProgress(50, 0)).toEqual({ pct: 0, barPct: 0, remaining: 0 })
    expect(targetProgress(150, 100)).toEqual({ pct: 150, barPct: 100, remaining: 0 })
    expect(targetProgress(25, 100)).toEqual({ pct: 25, barPct: 25, remaining: 75 })
  })
})

describe('invoice totals', () => {
  it('sums lines, applies discount before VAT, and rounds to satang', () => {
    const t = computeInvoiceTotals([{ amount: 200 }, { amount: 50 }], 0, 7)
    expect(t).toMatchObject({ subtotal: 250, vat_amount: 17.5, total: 267.5 })
    const d = computeInvoiceTotals([{ amount: 100 }], 10, 7)
    expect(d).toMatchObject({ subtotal: 100, net: 90, vat_amount: 6.3, total: 96.3 })
  })
  it('never goes negative when the discount exceeds the subtotal', () => {
    const t = computeInvoiceTotals([{ amount: 10 }], 50, 7)
    expect(t).toMatchObject({ net: 0, vat_amount: 0, total: 0 })
  })
  it('rounds half away from zero without float drift', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(-1.005)).toBe(-1.01)
    expect(computeInvoiceTotals([{ amount: 0.1 }, { amount: 0.2 }], 0, 0).subtotal).toBe(0.3)
  })
  it('recalculates the line amount when qty or price change, not when amount is typed', () => {
    const base = { ...blankItem(), qty: 2, unit_price: 5, amount: 10 }
    expect(updateItem(base, 'qty', '3').amount).toBe(15)
    expect(updateItem(base, 'unit_price', '2.5').amount).toBe(5)
    expect(updateItem(base, 'amount', '99').amount).toBe(99)
    expect(updateItem(base, 'description', 'Honey').description).toBe('Honey')
  })
  it('exports one row per line with repeated header fields, and a blank row if none', () => {
    const inv = {
      doc_no: 'INV-1', doc_date: '2026-10-03', customer_name: 'ACME', customer_tax_id: '', customer_address: '',
      customer_branch: '', subtotal: 250, discount: 0, vat_rate: 7, vat_amount: 17.5, total: 267.5,
      items: [{ sku: 'A', description: 'a', qty: 1, unit: 'u', unit_price: 50, amount: 50 }, { sku: 'B', description: 'b', qty: 2, unit: 'u', unit_price: 100, amount: 200 }],
    }
    const rows = invoiceToExportRows(inv)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ doc_no: 'INV-1', sku: 'B', total: 267.5 })
    expect(invoiceToExportRows({ ...inv, items: [] })).toHaveLength(1)
  })
})

describe('formatting', () => {
  it('formats money and numbers', () => {
    expect(formatMoney(1234.5)).toBe('฿1,234.50')
    expect(formatMoney('x')).toBe('฿0.00')
    expect(formatNumber(1234.567)).toBe('1,234.57')
  })
  it('gives month ranges as local calendar dates', () => {
    expect(monthRange(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(monthRange(2028, 2).end).toBe('2028-02-29')
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('import parsing', () => {
  it('parses numbers with separators and returns null for empty', () => {
    expect(parseNumber('1,234.50')).toBe(1234.5)
    expect(parseNumber('฿ 99')).toBe(99)
    expect(parseNumber('-3')).toBe(-3)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('-')).toBeNull()
    expect(parseNumber('n/a')).toBeNull()
    expect(parseNumber(7)).toBe(7)
  })
  it('parses dates in the formats Comet5 produces, including Buddhist years', () => {
    expect(parseDate('2026-10-03')).toBe('2026-10-03')
    expect(parseDate('3/10/2026')).toBe('2026-10-03')
    expect(parseDate('03-10-2569')).toBe('2026-10-03')
    expect(parseDate('3.10.26')).toBe('2026-10-03')
    expect(parseDate('2569-10-03')).toBe('2026-10-03')
    expect(parseDate(new Date(Date.UTC(2026, 9, 3)))).toBe('2026-10-03')
    expect(parseDate(46298)).toBe('2026-10-03') // Excel serial
  })
  it('rejects impossible or unrecognised dates', () => {
    expect(parseDate('31/02/2026')).toBe('')
    expect(parseDate('13/13/2026')).toBe('')
    expect(parseDate('yesterday')).toBe('')
    expect(parseDate('')).toBe('')
    expect(parseDate(new Date('nope'))).toBe('')
  })
  it('auto-maps Thai and English headers without reusing a column', () => {
    const m = autoMap('products', ['รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย', 'ราคาขาย', 'คงเหลือ', 'จุดสั่งซื้อ', 'หมวดหมู่'])
    expect(m).toMatchObject({ sku: 0, name_th: 1, unit: 2, unit_price: 3, stock_qty: 4, min_stock: 5, category: 6 })
    expect(m.cost_price).toBeNull()
    const s = autoMap('sales', ['Bill No', 'Date', 'SKU', 'Qty', 'Amount', 'Customer'])
    expect(s).toMatchObject({ bill_no: 0, sale_date: 1, sku: 2, qty: 3, amount: 4, customer_name: 5 })
  })
  it('does not let the short "unit" alias claim a unit-price column', () => {
    expect(autoMap('sales', ['เลขที่บิล', 'วันที่', 'รหัสสินค้า', 'จำนวน', 'ราคาต่อหน่วย', 'มูลค่า'])).toMatchObject({ unit: null, unit_price: 4 })
    expect(autoMap('sales', ['Bill No', 'Date', 'SKU', 'Qty', 'Unit Price', 'Amount'])).toMatchObject({ unit: null, unit_price: 4 })
  })
  it('chunks arrays', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})

describe('building product records', () => {
  const m = autoMap('products', ['SKU', 'Name', 'Price', 'Stock', 'Min'])
  it('requires a SKU and reports the spreadsheet row (header = row 1)', () => {
    const { records, problems } = buildProducts([['A1', 'Honey', '10', '5', '20'], ['', 'x', '1', '1', '1']], m)
    expect(records).toHaveLength(1)
    expect(problems).toEqual([{ row: 3, reason: 'sku' }])
  })
  it('uses null for blank numerics so existing data is kept', () => {
    const { records } = buildProducts([['A1', 'Honey', '', '', '']], m)
    expect(records[0]).toMatchObject({ unit_price: null, stock_qty: null, min_stock: null })
  })
  it('allows negative stock but rejects negative price or reorder point', () => {
    const ok = buildProducts([['A', 'n', '1', '-4', '10']], m)
    expect(ok.records[0]!.stock_qty).toBe(-4)
    const bad = buildProducts([['A', 'n', '-1', '4', '10'], ['B', 'n', '1', '4', '-10']], m)
    expect(bad.problems.map((p) => p.reason)).toEqual(['negative', 'negative'])
  })
})

describe('building sales records', () => {
  const m = autoMap('sales', ['Bill No', 'Date', 'SKU', 'Name', 'Qty', 'Price', 'Amount', 'Customer'])
  it('validates required fields with a reason per row', () => {
    const { records, problems } = buildSales(
      [
        ['B1', '2026-10-01', 'A', 'a', '2', '100', '200', 'ACME'],
        ['', '2026-10-01', 'A', 'a', '2', '100', '200', ''],
        ['B2', 'bad', 'A', 'a', '2', '100', '200', ''],
        ['B3', '2026-10-01', '', 'a', '2', '100', '200', ''],
        ['B4', '2026-10-01', 'A', 'a', '0', '100', '200', ''],
      ],
      m,
    )
    expect(records).toHaveLength(1)
    expect(problems).toEqual([
      { row: 3, reason: 'doc_no' }, { row: 4, reason: 'date' }, { row: 5, reason: 'sku' }, { row: 6, reason: 'qty' },
    ])
  })
  it('derives the amount from qty x price when missing, and keeps negative quantities (credit notes)', () => {
    const { records } = buildSales([['B1', '2026-10-01', 'A', 'a', '3', '10.5', '', ''], ['B2', '2026-10-01', 'A', 'a', '-1', '10', '-10', '']], m)
    expect(records[0]!.amount).toBe(31.5)
    expect(records[1]!.qty).toBe(-1)
  })
  it('numbers repeated bill/SKU pairs across the whole file', () => {
    const rows = [
      ['B1', '2026-10-01', 'A', 'a', '1', '1', '1', ''],
      ['B1', '2026-10-01', 'B', 'b', '1', '1', '1', ''],
      ['B1', '2026-10-01', 'A', 'a', '2', '1', '2', ''],
      ['B2', '2026-10-01', 'A', 'a', '1', '1', '1', ''],
    ]
    const { records } = buildSales(rows, m)
    expect(records.map((r) => r.line_no)).toEqual([1, 1, 2, 1])
    // the same file always yields the same keys -> idempotent re-import
    expect(buildSales(rows, m).records.map((r) => r.line_no)).toEqual([1, 1, 2, 1])
  })
})

describe('building invoice records', () => {
  const m = autoMap('invoices', ['Doc No', 'Date', 'Customer', 'Tax ID', 'SKU', 'Description', 'Qty', 'Unit Price', 'Amount'])
  it('groups lines by document number and fills blank header fields from later rows', () => {
    const { records, problems } = buildInvoices(
      [
        ['INV-1', '2026-10-03', '', '', 'A', 'Honey', '2', '100', '200'],
        ['INV-1', '2026-10-03', 'ACME', '0105560000000', 'B', '', '1', '50', ''],
        ['INV-2', '2026-10-04', 'Beta', '', 'C', 'Syrup', '1', '10', '10'],
        ['', '2026-10-04', 'x', '', 'D', 'd', '1', '1', '1'],
        ['INV-3', 'bad', 'x', '', 'D', 'd', '1', '1', '1'],
      ],
      m,
      7,
    )
    expect(records.map((r) => r.doc_no)).toEqual(['INV-1', 'INV-2'])
    expect(records[0]!.items).toHaveLength(2)
    expect(records[0]).toMatchObject({ customer_name: 'ACME', customer_tax_id: '0105560000000', vat_rate: 7 })
    expect(records[0]!.items[1]).toMatchObject({ description: 'B', amount: 50 }) // description falls back to SKU, amount to qty x price
    expect(problems).toEqual([{ row: 5, reason: 'doc_no' }, { row: 6, reason: 'date' }])
  })
})
