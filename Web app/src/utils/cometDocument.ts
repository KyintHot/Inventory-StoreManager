import type { ImportKind } from '@/types/database'
import type { Row } from './importMapping'
import { parseNumber } from './importMapping'

/* Comet5 prints its tax invoices with Crystal Reports and exports them as legacy .xls files:
 *   • Thai text sits in the file as single-byte Windows-874 bytes while the file declares a
 *     different codepage, so every reader — Excel included — shows mojibake. repair874()
 *     recognises that shape (high bytes, no real Thai) and re-decodes it.
 *   • The sheet is a printed page (label/value pairs around one item table), not a table, so
 *     parseCometDocument() finds the item header row, the header fields and the item rows and
 *     reshapes them into ordinary import rows for the selected kind.
 * Both steps run automatically when the file is chosen — nobody edits the file by hand. */

/** Re-decode a string whose Windows-874 bytes were read as Latin-1. Clean text passes through. */
export function repair874(text: string): string {
  if (!/[\u0080-\u00FF]/.test(text) || /[\u0E00-\u0E7F]/.test(text)) return text
  let decoded: string
  try {
    decoded = new TextDecoder('windows-874').decode(Uint8Array.from(text, (c) => c.charCodeAt(0)))
  } catch {
    return text
  }
  // Only commit when the re-decode looks genuinely Thai: at least two Thai characters making
  // up at least half of the high bytes — a lone accented Latin letter stays untouched.
  const high = [...text].filter((c) => c.charCodeAt(0) >= 0x80).length
  const thai = [...decoded].filter((c) => /[\u0E00-\u0E7F]/.test(c)).length
  return thai >= 2 && thai / high >= 0.5 ? decoded : text
}

/** Cell-wise repair of a parsed sheet (only string cells can be mojibake). */
export function repairSheet(rows: Row[]): Row[] {
  return rows.map((row) => row.map((cell) => (typeof cell === 'string' ? repair874(cell) : cell)))
}

export interface ReshapedTable {
  headers: string[]
  rows: Row[]
}

interface ItemCols {
  sku: number
  name: number | null
  qty: number
  unit: number | null
  price: number | null
  amount: number | null
}

/** Locate the printed item table's header row (รหัสสินค้า / จำนวน / ราคา …) and its columns. */
function findItemHeader(rows: Row[]): { index: number; cols: ItemCols } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? '').trim())
    const exact = (s: string) => cells.findIndex((c) => c === s)
    const qty = exact('จำนวน') >= 0 ? exact('จำนวน') : cells.findIndex((c) => c === 'qty' || c === 'quantity')
    if (qty < 0) continue
    const sku = cells.findIndex((c) => c.includes('รหัสสินค้า') || c === 'sku' || c === 'code')
    if (sku < 0) continue
    const price = cells.findIndex((c) => c.includes('ราคา'))
    let amount = cells.findIndex((c) => c.includes('มูลค่า') || c.includes('จำนวนเงิน'))
    if (price < 0 && amount < 0) continue
    if (price >= 0 && amount === price) amount = -1 // one money column can serve both roles
    const unitCol = exact('หน่วย') >= 0 ? exact('หน่วย') : cells.findIndex((c) => c === 'unit' || c === 'uom')
    const nameCol = cells.findIndex(
      (c) => c.includes('ชื่อสินค้า') || c === 'รายการ' || c === 'name' || c.includes('description'),
    )
    const cols: ItemCols = {
      sku,
      name: nameCol >= 0 ? nameCol : null,
      qty,
      unit: unitCol >= 0 ? unitCol : null,
      price: price >= 0 ? price : null,
      amount: amount >= 0 ? amount : null,
    }
    const used = [cols.sku, cols.qty, cols.name, cols.unit, cols.price, cols.amount].filter(
      (x): x is number => x !== null,
    )
    if (new Set(used).size !== used.length) continue // a column claimed twice is not our table
    return { index: i, cols }
  }
  return null
}

interface LabelValue {
  label: string
  value: unknown
}

/** Every "label :" cell on the page paired with the first non-empty cell to its right. */
function labelValuePairs(rows: Row[]): LabelValue[] {
  const out: LabelValue[] = []
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      const label = String(row[c] ?? '').trim()
      if (!label.includes(':')) continue
      for (let v = c + 1; v < Math.min(c + 4, row.length); v++) {
        const value = row[v]
        if (value !== null && value !== undefined && String(value).trim() !== '') {
          out.push({ label, value })
          break
        }
      }
    }
  }
  return out
}

/** Item rows: a numeric qty in the qty column plus a SKU or a name — totals and footers fail this. */
function collectItemRows(rows: Row[], cols: ItemCols, from: number): Row[] {
  const out: Row[] = []
  for (let i = from; i < rows.length; i++) {
    const row = rows[i] ?? []
    const qty = parseNumber(row[cols.qty])
    if (!qty) continue
    const sku = String(row[cols.sku] ?? '').trim()
    const name = cols.name !== null ? String(row[cols.name] ?? '').trim() : ''
    if (!sku && !name) continue
    out.push(row)
  }
  return out
}

/**
 * Pick the import type a sheet actually fits. The Import page defaults to "products", but a
 * printed Comet5 invoice dropped in without changing the type used to show the raw document
 * grid as 16 unusable rows full of "SKU is missing" — detect it and route it to invoices.
 * Other kinds are never second-guessed (the user chose them deliberately).
 */
export function resolveImportKind(rows: Row[], kind: ImportKind): ImportKind {
  if (kind !== 'products') return kind
  return parseCometDocument(rows, 'invoices') !== null ? 'invoices' : 'products'
}

/**
 * Reshape a printed Comet5 invoice page into import rows for `kind`.
 * Returns null when the sheet is already a normal table (no item header, or no invoice number
 * and date) — the caller then keeps the original rows untouched.
 */
export function parseCometDocument(rawRows: Row[], kind: 'sales' | 'invoices'): ReshapedTable | null {
  const table = findItemHeader(rawRows)
  if (!table) return null

  const pairs = labelValuePairs(rawRows)
  const first = (pred: (label: string) => boolean) => pairs.find((p) => pred(p.label))?.value
  const docNo =
    first((l) => l.includes('ใบกำกับ') || l.includes('ใบแจ้งหนี้')) ??
    first((l) => l.includes('เลขที่') && !l.includes('ใบส่ง'))
  const docDate = first((l) => l.includes('วันที่'))
  const customer = first((l) => l.includes('ชื่อ') && !l.includes('รหัส'))
  const taxId = first((l) => l.includes('เลขประจำตัวผู้เสียภาษี'))
  const address = first((l) => l.includes('ที่อยู่'))
  const branch = first((l) => l.includes('สาขา'))
  const present = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== ''
  if (!present(docNo) || !present(docDate)) return null // not a recognisable invoice page

  const c = table.cols
  const cell = (row: Row, i: number | null) => (i === null ? '' : (row[i] ?? ''))
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
  const items = collectItemRows(rawRows, c, table.index + 1)

  if (kind === 'invoices') {
    const headers = [
      'doc_no',
      'doc_date',
      'customer_name',
      'customer_tax_id',
      'customer_address',
      'customer_branch',
      'sku',
      'description',
      'qty',
      'unit',
      'unit_price',
      'amount',
    ]
    // an invoice page with no items still imports as a header-only document
    const body: Row[] = items.length ? items : [Array.from({ length: headers.length }, () => '')]
    return {
      headers,
      rows: body.map((r) => [
        str(docNo),
        docDate,
        str(customer),
        str(taxId),
        str(address),
        str(branch),
        cell(r, c.sku),
        cell(r, c.name),
        cell(r, c.qty),
        cell(r, c.unit),
        cell(r, c.price),
        cell(r, c.amount),
      ]),
    }
  }

  const headers = ['bill_no', 'sale_date', 'sku', 'product_name', 'qty', 'unit', 'unit_price', 'amount', 'customer_name']
  return {
    headers,
    rows: items.map((r) => [
      str(docNo),
      docDate,
      cell(r, c.sku),
      cell(r, c.name),
      cell(r, c.qty),
      cell(r, c.unit),
      cell(r, c.price),
      cell(r, c.amount),
      str(customer),
    ]),
  }
}
