import type { ImportKind, InvoiceItem } from '@/types/database'
import { round2 } from './invoice'

/* Column auto-matching and row validation for Comet5 exports.
 * Field lists and header aliases (Thai + English) are carried over from the Base44 app. */

export interface FieldSpec {
  key: string
  label: string
  required?: boolean
  aliases: string[]
}

const SKU_ALIASES = ['sku', 'รหัสสินค้า', 'รหัส', 'code', 'product code', 'item code', 'รหัสสินค้า/บริการ']
const NAME_ALIASES = ['ชื่อสินค้า', 'ชื่อ', 'รายการ', 'name', 'product name', 'description', 'สินค้า', 'รายละเอียด']

export const FIELD_SPECS: Record<ImportKind, FieldSpec[]> = {
  products: [
    { key: 'sku', label: 'SKU', required: true, aliases: SKU_ALIASES },
    { key: 'name_th', label: 'ชื่อสินค้า / Product name', aliases: NAME_ALIASES },
    { key: 'name_en', label: 'Name (EN)', aliases: ['name_en', 'english name', 'name (en)', 'ชื่อภาษาอังกฤษ'] },
    { key: 'category', label: 'หมวดหมู่', aliases: ['หมวด', 'หมวดหมู่', 'กลุ่ม', 'category', 'group', 'type', 'ประเภท'] },
    { key: 'unit', label: 'หน่วย', aliases: ['หน่วย', 'unit', 'uom', 'หน่วยนับ'] },
    { key: 'unit_price', label: 'ราคาขาย', aliases: ['ราคาขาย', 'ราคา', 'unit price', 'price', 'ราคาต่อหน่วย'] },
    { key: 'cost_price', label: 'ราคาทุน', aliases: ['ราคาทุน', 'ต้นทุน', 'cost'] },
    { key: 'stock_qty', label: 'คงเหลือ', aliases: ['คงเหลือ', 'จำนวนคงเหลือ', 'สต็อก', 'สต๊อก', 'stock', 'balance', 'qty', 'quantity', 'จำนวน'] },
    { key: 'min_stock', label: 'จุดสั่งซื้อ', aliases: ['จุดสั่งซื้อ', 'สต็อกขั้นต่ำ', 'ขั้นต่ำ', 'min', 'minimum', 'reorder', 'min stock'] },
    { key: 'supplier', label: 'ผู้จำหน่าย', aliases: ['ผู้จำหน่าย', 'ซัพพลายเออร์', 'supplier', 'vendor'] },
  ],
  sales: [
    { key: 'bill_no', label: 'เลขที่บิล', required: true, aliases: ['เลขที่บิล', 'เลขที่เอกสาร', 'เลขที่', 'bill', 'bill no', 'doc no', 'invoice no', 'เลขที่ใบกำกับ'] },
    { key: 'sale_date', label: 'วันที่', required: true, aliases: ['วันที่', 'date', 'sale date', 'วันที่ขาย'] },
    { key: 'sku', label: 'รหัสสินค้า', required: true, aliases: SKU_ALIASES },
    { key: 'product_name', label: 'ชื่อสินค้า', aliases: NAME_ALIASES },
    { key: 'qty', label: 'จำนวน', required: true, aliases: ['จำนวน', 'qty', 'quantity', 'จำนวนขาย'] },
    { key: 'unit', label: 'หน่วย', aliases: ['หน่วย', 'unit', 'uom'] },
    { key: 'unit_price', label: 'ราคาต่อหน่วย', aliases: ['ราคาต่อหน่วย', 'ราคาขาย', 'ราคา', 'unit price', 'price'] },
    { key: 'amount', label: 'มูลค่า', aliases: ['มูลค่า', 'จำนวนเงิน', 'ยอดรวม', 'amount', 'total', 'net'] },
    { key: 'customer_name', label: 'ลูกค้า', aliases: ['ลูกค้า', 'ชื่อลูกค้า', 'customer', 'client', 'ผู้ซื้อ'] },
  ],
  invoices: [
    { key: 'doc_no', label: 'เลขที่ใบกำกับภาษี', required: true, aliases: ['เลขที่ใบกำกับภาษี', 'เลขที่เอกสาร', 'เลขที่', 'doc no', 'invoice no', 'เลขที่ใบกำกับ'] },
    { key: 'doc_date', label: 'วันที่', required: true, aliases: ['วันที่', 'date', 'วันที่เอกสาร'] },
    { key: 'customer_name', label: 'ลูกค้า', aliases: ['ลูกค้า', 'ชื่อลูกค้า', 'customer', 'client', 'ผู้ซื้อ'] },
    { key: 'customer_tax_id', label: 'เลขประจำตัวผู้เสียภาษีลูกค้า', aliases: ['เลขประจำตัวผู้เสียภาษี', 'เลขภาษี', 'tax id', 'เลขผู้เสียภาษี'] },
    { key: 'customer_address', label: 'ที่อยู่ลูกค้า', aliases: ['ที่อยู่', 'ที่อยู่ลูกค้า', 'address'] },
    { key: 'customer_branch', label: 'สาขา', aliases: ['สาขา', 'branch', 'สำนักงานใหญ่'] },
    { key: 'sku', label: 'รหัสสินค้า', aliases: SKU_ALIASES },
    { key: 'description', label: 'รายการ', aliases: [...NAME_ALIASES, 'item'] },
    { key: 'qty', label: 'จำนวน', aliases: ['จำนวน', 'qty', 'quantity'] },
    { key: 'unit', label: 'หน่วย', aliases: ['หน่วย', 'unit', 'uom'] },
    { key: 'unit_price', label: 'ราคาต่อหน่วย', aliases: ['ราคาต่อหน่วย', 'ราคาขาย', 'ราคา', 'unit price', 'price'] },
    { key: 'amount', label: 'จำนวนเงิน', aliases: ['จำนวนเงิน', 'มูลค่า', 'ยอดรวม', 'amount', 'total', 'net'] },
  ],
}

export type Mapping = Record<string, number | null>
export type Cell = unknown
export type Row = Cell[]

export function normalizeHeader(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/[\s_\-./()]/g, '').trim()
}

/**
 * Match each field to a file column. Pass 1 takes exact alias matches for every field;
 * pass 2 falls back to substring matches for what is left. Doing exact matches first stops a
 * short alias such as "unit"/"หน่วย" from claiming "Unit Price"/"ราคาต่อหน่วย" (a Base44 flaw).
 */
const candidatesOf = (f: FieldSpec) => [...f.aliases, f.key, f.label].map(normalizeHeader)

export function autoMap(kind: ImportKind, headers: string[]): Mapping {
  const specs = FIELD_SPECS[kind]
  const mapping: Mapping = Object.fromEntries(specs.map((f) => [f.key, null as number | null]))
  const used = new Set<number>()
  const norm = headers.map(normalizeHeader)

  for (const field of specs) {
    const candidates = candidatesOf(field)
    const idx = norm.findIndex((h, i) => h && !used.has(i) && candidates.includes(h))
    if (idx !== -1) {
      mapping[field.key] = idx
      used.add(idx)
    }
  }
  for (const field of specs) {
    if (mapping[field.key] !== null) continue
    const candidates = candidatesOf(field)
    const idx = norm.findIndex((h, i) => h && !used.has(i) && candidates.some((c) => c && (h.includes(c) || c.includes(h))))
    if (idx !== -1) {
      mapping[field.key] = idx
      used.add(idx)
    }
  }
  return mapping
}

/** Number or null when empty/unparseable (null = "not provided", so existing data is kept). */
export function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const cleaned = String(v).replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function parseText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString()
  return String(v).trim()
}

function isoFromParts(year: number, month: number, day: number): string {
  // Thai exports often use Buddhist-era years (2569 = 2026).
  const y = year > 2400 ? year - 543 : year
  const probe = new Date(Date.UTC(y, month - 1, day))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return ''
  return `${String(y).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Returns YYYY-MM-DD or '' when the value is not a recognisable, valid calendar date. */
export function parseDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    // spreadsheet readers return UTC-midnight dates: read UTC parts to avoid timezone drift
    return isoFromParts(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
  }
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000)) // Excel serial date
    return Number.isNaN(d.getTime()) ? '' : isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  const s = String(v).trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (dmy) {
    let y = Number(dmy[3])
    if (y < 100) y += 2000
    return isoFromParts(y, Number(dmy[2]), Number(dmy[1]))
  }
  return ''
}

/**
 * How well `headers` fit `kind`. `fits` = every required field found a column; `score` weights
 * each hit by 2 for an exact alias match and 1 for the substring fallback, because exact hits
 * are what separate a sales table ("เลขที่บิล") from an invoice table ("เลขที่ใบกำกับภาษี")
 * that both reach the same `bill_no`/`doc_no` alias through substring matching.
 */
export function kindFit(kind: ImportKind, headers: string[]): { fits: boolean; score: number } {
  const mapping = autoMap(kind, headers)
  const specs = FIELD_SPECS[kind]
  const fits = specs.every((f) => !f.required || mapping[f.key] !== null)
  const norm = headers.map(normalizeHeader)
  let score = 0
  for (const f of specs) {
    const idx = mapping[f.key]
    if (idx === null || idx === undefined) continue
    score += candidatesOf(f).includes(norm[idx]!) ? 2 : 1
  }
  return { fits, score }
}

const KIND_ORDER: ImportKind[] = ['products', 'sales', 'invoices']

/**
 * Pick the import type a table actually fits, given the type currently selected.
 *
 * The Import page starts on "products", which accepts almost any header row (only SKU is
 * required), so a Comet5 **sales** export dropped in without changing the type used to import
 * as products — quietly writing sold quantities into the stock column and overwriting prices.
 * Score every type against the headers and move only when another type fits and fits strictly
 * better: the selected type wins every tie, and if nothing fits the selection is left alone so
 * the mapping screen can show which required columns are missing.
 */
export function detectImportKind(headers: string[], current: ImportKind): ImportKind {
  const score = (k: ImportKind) => kindFit(k, headers).score
  const fits = KIND_ORDER.filter((k) => kindFit(k, headers).fits)
  const bestOf = (kinds: ImportKind[]) =>
    kinds.reduce((best, k) => (score(k) > score(best) ? k : best))
  if (!fits.length) return current // nothing fits: keep the selection so the UI can explain why
  if (!fits.includes(current)) return bestOf(fits) // the selected type cannot take this file
  const others = fits.filter((k) => k !== current)
  return others.length && score(bestOf(others)) > score(current) ? bestOf(others) : current
}

export type ProblemReason = 'sku' | 'date' | 'qty' | 'doc_no' | 'negative'
export interface Problem { row: number; reason: ProblemReason }

export interface ProductRecord {
  sku: string; name_th: string; name_en: string; category: string; unit: string; supplier: string
  unit_price: number | null; cost_price: number | null; stock_qty: number | null; min_stock: number | null
}
export interface SaleRecord {
  bill_no: string; sale_date: string; sku: string; product_name: string; qty: number; unit: string
  unit_price: number; amount: number; customer_name: string; line_no: number
}
export interface InvoiceRecord {
  doc_no: string; doc_date: string; customer_name: string; customer_tax_id: string
  customer_address: string; customer_branch: string; items: InvoiceItem[]; vat_rate: number
}
export type ImportRecord = ProductRecord | SaleRecord | InvoiceRecord

export interface BuildResult<T> { records: T[]; problems: Problem[] }

const cell = (row: Row, idx: number | null | undefined): Cell => (idx === null || idx === undefined ? '' : row[idx])

export function buildProducts(rows: Row[], m: Mapping): BuildResult<ProductRecord> {
  const records: ProductRecord[] = []
  const problems: Problem[] = []
  rows.forEach((row, i) => {
    const rowNo = i + 2 // header is row 1
    const sku = parseText(cell(row, m.sku))
    if (!sku) return void problems.push({ row: rowNo, reason: 'sku' })
    const unit_price = parseNumber(cell(row, m.unit_price))
    const cost_price = parseNumber(cell(row, m.cost_price))
    const min_stock = parseNumber(cell(row, m.min_stock))
    if ((unit_price ?? 0) < 0 || (cost_price ?? 0) < 0 || (min_stock ?? 0) < 0) {
      return void problems.push({ row: rowNo, reason: 'negative' })
    }
    records.push({
      sku,
      name_th: parseText(cell(row, m.name_th)),
      name_en: parseText(cell(row, m.name_en)),
      category: parseText(cell(row, m.category)),
      unit: parseText(cell(row, m.unit)),
      supplier: parseText(cell(row, m.supplier)),
      unit_price, cost_price, min_stock,
      stock_qty: parseNumber(cell(row, m.stock_qty)), // may be negative in Comet5
    })
  })
  return { records, problems }
}

/** `line_no` numbers repeated (bill, SKU) pairs across the WHOLE file so re-imports are idempotent. */
export function buildSales(rows: Row[], m: Mapping): BuildResult<SaleRecord> {
  const records: SaleRecord[] = []
  const problems: Problem[] = []
  const seen = new Map<string, number>()
  rows.forEach((row, i) => {
    const rowNo = i + 2
    const bill_no = parseText(cell(row, m.bill_no))
    const sale_date = parseDate(cell(row, m.sale_date))
    const sku = parseText(cell(row, m.sku))
    const qty = parseNumber(cell(row, m.qty)) ?? 0
    if (!bill_no) return void problems.push({ row: rowNo, reason: 'doc_no' })
    if (!sale_date) return void problems.push({ row: rowNo, reason: 'date' })
    if (!sku) return void problems.push({ row: rowNo, reason: 'sku' })
    if (!qty) return void problems.push({ row: rowNo, reason: 'qty' })
    const unit_price = parseNumber(cell(row, m.unit_price)) ?? 0
    const amount = parseNumber(cell(row, m.amount)) || round2(qty * unit_price)
    const key = `${bill_no}|${sku}`
    const line_no = (seen.get(key) ?? 0) + 1
    seen.set(key, line_no)
    records.push({
      bill_no, sale_date, sku, qty, unit_price, amount, line_no,
      product_name: parseText(cell(row, m.product_name)),
      unit: parseText(cell(row, m.unit)),
      customer_name: parseText(cell(row, m.customer_name)),
    })
  })
  return { records, problems }
}

/** One invoice per doc_no; header fields come from the first row, blanks are filled by later rows. */
export function buildInvoices(rows: Row[], m: Mapping, vatRate: number): BuildResult<InvoiceRecord> {
  const problems: Problem[] = []
  const byDoc = new Map<string, InvoiceRecord>()
  rows.forEach((row, i) => {
    const rowNo = i + 2
    const doc_no = parseText(cell(row, m.doc_no))
    const doc_date = parseDate(cell(row, m.doc_date))
    if (!doc_no) return void problems.push({ row: rowNo, reason: 'doc_no' })
    if (!doc_date) return void problems.push({ row: rowNo, reason: 'date' })
    const qty = parseNumber(cell(row, m.qty)) ?? 0
    const unit_price = parseNumber(cell(row, m.unit_price)) ?? 0
    const amount = parseNumber(cell(row, m.amount)) || round2(qty * unit_price)
    let inv = byDoc.get(doc_no)
    if (!inv) {
      inv = {
        doc_no, doc_date,
        customer_name: parseText(cell(row, m.customer_name)),
        customer_tax_id: parseText(cell(row, m.customer_tax_id)),
        customer_address: parseText(cell(row, m.customer_address)),
        customer_branch: parseText(cell(row, m.customer_branch)),
        items: [],
        vat_rate: Number.isFinite(vatRate) ? vatRate : 7,
      }
      byDoc.set(doc_no, inv)
    }
    inv.customer_name ||= parseText(cell(row, m.customer_name))
    inv.customer_tax_id ||= parseText(cell(row, m.customer_tax_id))
    inv.customer_address ||= parseText(cell(row, m.customer_address))
    inv.customer_branch ||= parseText(cell(row, m.customer_branch))
    const sku = parseText(cell(row, m.sku))
    inv.items.push({
      sku,
      description: parseText(cell(row, m.description)) || sku,
      qty, unit: parseText(cell(row, m.unit)), unit_price, amount,
    })
  })
  return { records: [...byDoc.values()], problems }
}

export function buildRecords(
  kind: ImportKind,
  rows: Row[],
  mapping: Mapping,
  opts: { vatRate?: number } = {},
): BuildResult<ImportRecord> {
  if (kind === 'products') return buildProducts(rows, mapping)
  if (kind === 'sales') return buildSales(rows, mapping)
  return buildInvoices(rows, mapping, opts.vatRate ?? 7)
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
