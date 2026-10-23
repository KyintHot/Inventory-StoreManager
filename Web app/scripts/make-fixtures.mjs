/**
 * Regenerates the Comet5 .xls test fixtures as fully synthetic documents.
 *
 * The originals were real Crystal Reports tax invoices from the field and carried real customer
 * names, addresses, phone numbers and 13-digit Thai tax IDs. They are public-repo test data, so
 * every identifier here is invented: no real company, customer, address, phone or tax ID appears.
 *
 * The generated files intentionally reproduce the two quirks the app must survive:
 *   • Thai text stored as Windows-874 bytes under a wrong codepage (mojibake in Excel too) —
 *     `toMojibake()` writes the CP874 bytes and the reader's repair874() re-decodes them.
 *   • A printed invoice page (label/value pairs around one item table) instead of a table.
 *
 * Run: node scripts/make-fixtures.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../tests/fixtures/comet5')

/** Encode Thai text as CP874 bytes, then read them back as Latin-1 → the real files' mojibake. */
const CP874 = new Map()
for (let b = 0x80; b <= 0xff; b++) {
  try {
    const ch = new TextDecoder('windows-874').decode(Uint8Array.of(b))
    if (ch.length === 1 && ch !== '�') CP874.set(ch, b)
  } catch {
    /* undefined byte */
  }
}
function toMojibake(text) {
  let out = ''
  for (const ch of text) {
    if (ch.codePointAt(0) < 0x80) out += ch
    else {
      const byte = CP874.get(ch)
      out += byte === undefined ? ch : String.fromCharCode(byte)
    }
  }
  return out
}

/** Fake company identity — deliberately not the real business. */
const SELLER = {
  name: 'บริษัท ตัวอย่างฮาร์ดแวร์ จำกัด',
  address: '99/9 ซ.สาธิต ถ.ตัวอย่าง เขตบางนา กรุงเทพ 10240',
  phone: '02-000-0000',
  fax: '02-000-0001',
  taxId: '0105550000000',
}

/**
 * Synthetic invoices. doc_no / date / sku / totals are the values the unit and e2e suites
 * assert, so changing them here means updating tests/unit/cometDocument.test.ts and
 * e2e/app.spec.ts too.
 */
const INVOICES = [
  {
    file: '6666.xls',
    doc: 'INV-900001',
    ref: 'A0000000000000000001',
    dateBuddhist: '19/10/2569',
    customer: { name: 'บริษัท ลูกค้าแห่งหนึ่ง จำกัด', taxId: '0105550000001', address: '11/22 ซ.ทดสอบ เขตคลองเตย กรุงเทพ 10110' },
    items: [{ sku: '000001', name: 'สินค้าตัวอย่าง รุ่น ก', qty: 1, unit: 'อัน', price: 550 }],
  },
  {
    file: '7777.xls',
    doc: 'INV-900002',
    ref: 'A0000000000000000002',
    dateBuddhist: '17/10/2569',
    customer: { name: 'ห้างหุ้นส่วนจำกัด ตัวอย่างสอง', taxId: '0105550000002', address: '33/44 ถ.จำลอง เขตหลักสี่ กรุงเทพ 10230' },
    items: [
      { sku: '000011', name: 'วัสดุตัวอย่าง ชนิด ข', qty: 1, unit: 'ปิ๊ป', price: 400 },
      { sku: '000012', name: 'หลอดไฟตัวอย่าง 24 วัตต์', qty: 2, unit: 'ชุด', price: 150 },
      { sku: '000013', name: 'เทปตัวอย่าง แบบ ค', qty: 1, unit: 'อัน', price: 15 },
    ],
  },
  {
    file: '8888.xls',
    doc: 'INV-900003',
    ref: 'A0000000000000000003',
    dateBuddhist: '17/10/2569',
    customer: { name: 'บริษัท ลูกค้าแห่งสาม จำกัด', taxId: '0105550000003', address: '55/6 ซ.ตัวอย่าง เขตมีนบุรี กรุงเทพ 10510' },
    items: [
      { sku: '000021', name: 'ดอกสว่านตัวอย่าง 3.6 มิล', qty: 2, unit: 'ดอก', price: 42 },
      { sku: '000022', name: 'แปรงทาสีตัวอย่าง หนา', qty: 4, unit: 'อัน', price: 25 },
    ],
  },
]

/** Amount in Thai words, the way a printed receipt spells it out. */
const ONES = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
function bahtWords(n) {
  if (n === 0) return 'ศูนย์บาทถ้วน'
  const thousands = Math.floor(n / 1000)
  const rest = n % 1000
  let out = ''
  if (thousands) out += `${ONES[thousands]}พัน`
  const h = Math.floor(rest / 100)
  const t = Math.floor((rest % 100) / 10)
  const o = rest % 10
  if (h) out += `${h === 1 ? 'หนึ่งร้อย' : `${ONES[h]}ร้อย`}`
  if (t) out += t === 1 ? 'สิบ' : `${ONES[t]}สิบ`
  if (o) out += t === 1 && o === 1 ? 'เอ็ด' : ONES[o]
  return `${out}บาทถ้วน`
}

const PAD = 12 // label at col 8, value at col 9 — matches the real page layout
const row = (leading, label, value) => {
  const cells = [...leading]
  while (cells.length < 8) cells.push(null)
  cells.push(label ?? null, value ?? null, null, null)
  return cells.slice(0, PAD)
}

function buildSheet(inv) {
  const gross = inv.items.reduce((s, i) => s + i.qty * i.price, 0)
  const net = Math.round((gross / 1.07) * 100) / 100
  const vat = Math.round((gross - net) * 100) / 100

  const rows = [
    // Row 0 becomes the sheet's header row and is dropped from the body, so it carries only the
    // seller name and the document title (no "label :" pairs) — exactly like the real exports.
    row([SELLER.name], 'ใบเสร็จรับเงิน / ใบกำกับภาษี'),
    row([SELLER.address], 'วันที่ :', inv.dateBuddhist),
    row([SELLER.phone], 'เลขที่ใบกำกับภาษี :', inv.doc),
    row([SELLER.fax], 'เลขที่อ้างอิง :', inv.ref),
    row([`เลขประจำตัวผู้เสียภาษี ${SELLER.taxId}`]),
    row([null], 'ชื่อ :', inv.customer.name),
    row([null], 'เลขประจำตัวผู้เสียภาษี :', inv.customer.taxId),
    row([null], 'ที่อยู่ :', inv.customer.address),
    row([null], null, null).map((c, i) =>
      i === 0 ? 'รหัสสินค้า' : i === 2 ? 'ชื่อสินค้า' : i === 8 ? 'จำนวน' : i === 9 ? 'หน่วย' : i === 10 ? 'ราคา/หน่วย' : i === 11 ? 'จำนวนเงิน' : c,
    ),
  ]

  for (const it of inv.items) {
    rows.push(row([it.sku], null, null).map((c, i) => (i === 2 ? it.name : i === 8 ? it.qty : i === 9 ? it.unit : i === 10 ? it.price : i === 11 ? it.qty * it.price : c)))
  }

  rows.push(row([null], 'สินค้าไม่มีภาษี :', 0))
  rows.push(row([null], 'สินค้ามีภาษี :', net))
  rows.push(row([null], 'ภาษีมูลค่าเพิ่ม 7% :', vat))
  rows.push(row([null], 'รวมจำนวนเงินทั้งสิ้น :', gross))
  rows.push(row([`=${bahtWords(gross)}=`]))
  rows.push(row([null], null, null).map((c, i) => (i === 1 ? 'ผู้ตรวจสินค้า' : i === 4 ? 'ผู้ส่งสินค้า' : i === 7 ? 'ผู้อนุมัติ' : i === 10 ? 'ผู้รับเงิน' : c)))
  return rows
}

mkdirSync(OUT, { recursive: true })
for (const inv of INVOICES) {
  const mojibake = buildSheet(inv).map((r) => r.map((c) => (typeof c === 'string' ? toMojibake(c) : c)))
  const ws = XLSX.utils.aoa_to_sheet(mojibake)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { bookType: 'biff8', type: 'buffer' })
  writeFileSync(path.join(OUT, inv.file), buf)
  const gross = inv.items.reduce((s, i) => s + i.qty * i.price, 0)
  console.log(`${inv.file}  ${inv.doc}  ${inv.dateBuddhist}  items=${inv.items.length}  subtotal=${gross}  ${buf.length} bytes`)
}
