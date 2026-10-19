import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCometDocument, repair874, resolveImportKind } from '@/utils/cometDocument'
import { autoMap, buildInvoices, buildSales } from '@/utils/importMapping'
import { readTableFile } from '@/utils/readTable'

/**
 * Real Comet5 exports (Crystal Reports .xls) as they arrive from the field: Thai text stored
 * as Windows-874 bytes under a wrong codepage (mojibake in Excel too) and a printed invoice
 * page instead of a table. The app must read, repair and reshape them without any manual
 * cleaning — that contract is asserted here against the actual files.
 */

const FIXTURES = path.resolve(__dirname, '../fixtures/comet5')

function fixture(name: string): File {
  return new File([new Uint8Array(readFileSync(path.join(FIXTURES, name)))], name)
}

describe('repair874', () => {
  it('re-decodes Windows-874 bytes that were read as Latin-1', () => {
    // "บริษัท" as the file stores it: bytes BA C3 D4 C9 D1 B7 misread as ºÃÔÉÑ·
    const mojibake = String.fromCharCode(0xba, 0xc3, 0xd4, 0xc9, 0xd1, 0xb7)
    expect(repair874(mojibake)).toBe('บริษัท')
  })

  it('leaves clean text alone', () => {
    expect(repair874('INV-900001')).toBe('INV-900001')
    expect(repair874('บริษัท ทดสอบ จำกัด')).toBe('บริษัท ทดสอบ จำกัด')
    expect(repair874('Café')).toBe('Café') // one accented Latin letter is not Thai evidence
  })
})

describe('reading the real Comet5 files', () => {
  const cases = [
    // dates arrive as Thai Buddhist dd/mm/YYYY strings (19/10/2569 = 19 Oct 2026) and must
    // come out of buildInvoices as ISO dates
    { file: '6666.xls', doc: 'INV-900001', date: '2026-10-19', items: 1, subtotal: 550, sku: '000001' },
    { file: '7777.xls', doc: 'INV-900002', date: '2026-10-17', items: 3, subtotal: 715, sku: '000011' },
    { file: '8888.xls', doc: 'INV-900003', date: '2026-10-17', items: 2, subtotal: 184, sku: '000021' },
  ]

  for (const c of cases) {
    it(`${c.file} reads, repairs and reshapes into an invoice with ${c.items} item(s)`, async () => {
      const table = await readTableFile(fixture(c.file))
      expect(table.rows.length).toBeGreaterThan(3)

      const shaped = parseCometDocument(table.rows, 'invoices')
      expect(shaped, `${c.file} should be recognised as a printed invoice document`).not.toBeNull()

      const mapping = autoMap('invoices', shaped!.headers)
      expect(mapping.doc_no).toBe(0)
      expect(mapping.doc_date).toBe(1)
      expect(mapping.sku).not.toBeNull()
      expect(mapping.qty).not.toBeNull()

      const { records, problems } = buildInvoices(shaped!.rows, mapping, 7)
      expect(problems).toEqual([])
      expect(records).toHaveLength(1)
      const inv = records[0] as { doc_no: string; doc_date: string; items: { sku: string; amount: number }[] }
      expect(inv.doc_no).toBe(c.doc)
      expect(inv.doc_date).toBe(c.date)
      expect(inv.items).toHaveLength(c.items)
      expect(inv.items[0]!.sku).toBe(c.sku)
      expect(inv.items.reduce((sum, i) => sum + i.amount, 0)).toBe(c.subtotal)
    })

    it(`${c.file} reshapes into sales rows that feed the money charts`, async () => {
      const table = await readTableFile(fixture(c.file))
      const shaped = parseCometDocument(table.rows, 'sales')
      expect(shaped, `${c.file} should reshape for the sales kind too`).not.toBeNull()

      const mapping = autoMap('sales', shaped!.headers)
      expect(mapping.bill_no).not.toBeNull()
      expect(mapping.sale_date).not.toBeNull()
      expect(mapping.qty).not.toBeNull()

      const { records, problems } = buildSales(shaped!.rows, mapping)
      expect(problems).toEqual([])
      expect(records).toHaveLength(c.items)
      expect(records.every((r) => r.bill_no === c.doc)).toBe(true)
      expect(records.every((r) => r.line_no === 1)).toBe(true)
      expect(records.reduce((sum, r) => sum + r.amount, 0)).toBe(c.subtotal)
    })
  }

  it('leaves ordinary tabular sheets untouched', async () => {
    const csv = new File(['sku,name,qty\nHW-1,Bolt,5\n'], 'products.csv', { type: 'text/csv' })
    const table = await readTableFile(csv)
    expect(table.headers).toEqual(['sku', 'name', 'qty'])
    expect(parseCometDocument(table.rows, 'invoices')).toBeNull()
  })
})

describe('resolveImportKind', () => {
  it('routes a printed invoice that arrived under "products" to the invoices type', async () => {
    const table = await readTableFile(fixture('6666.xls'))
    expect(resolveImportKind(table.rows, 'products')).toBe('invoices')
    // the type the user deliberately chose is never second-guessed
    expect(resolveImportKind(table.rows, 'sales')).toBe('sales')
    expect(resolveImportKind(table.rows, 'invoices')).toBe('invoices')
  })

  it('keeps a real product table on products', () => {
    const rows = [['HW-1', 'Bolt'], ['HW-2', 'Nut']]
    expect(resolveImportKind(rows, 'products')).toBe('products')
  })
})
