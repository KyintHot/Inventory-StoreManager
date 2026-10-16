import type { InvoiceItem, TaxInvoice } from '@/types/database'

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Round to satang (2 dp), half away from zero, avoiding binary-float drift (1.005 -> 1.01). */
export function round2(v: number): number {
  const sign = v < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(v) * 100 + 1e-9)) / 100
}

export function blankItem(): InvoiceItem {
  return { sku: '', description: '', qty: 0, unit: '', unit_price: 0, amount: 0 }
}

export interface InvoiceTotals {
  subtotal: number
  discount: number
  net: number
  vat_rate: number
  vat_amount: number
  total: number
}

/**
 * Live preview of the totals the database trigger will compute on save
 * (`public.compute_invoice_totals`). The database result is authoritative.
 */
export function computeInvoiceTotals(
  items: Pick<InvoiceItem, 'amount'>[],
  discount: unknown,
  vatRate: unknown,
): InvoiceTotals {
  const subtotal = round2(items.reduce((s, i) => s + num(i.amount), 0))
  const disc = Math.max(0, num(discount))
  const net = Math.max(0, subtotal - disc)
  const rate = num(vatRate)
  const vat_amount = round2((net * rate) / 100)
  return { subtotal, discount: disc, net, vat_rate: rate, vat_amount, total: round2(net + vat_amount) }
}

/** Editing a qty/unit price recalculates the line amount; editing the amount keeps it as typed. */
export function updateItem(item: InvoiceItem, field: keyof InvoiceItem, raw: string): InvoiceItem {
  if (field === 'qty' || field === 'unit_price') {
    const next = { ...item, [field]: num(raw) }
    next.amount = round2(next.qty * next.unit_price)
    return next
  }
  if (field === 'amount') return { ...item, amount: num(raw) }
  return { ...item, [field]: raw }
}

/** One row per invoice line, repeating header fields — the layout the Comet5 import expects. */
export function invoiceToExportRows(inv: Pick<TaxInvoice, 'doc_no' | 'doc_date' | 'customer_name' | 'customer_tax_id' | 'customer_address' | 'customer_branch' | 'items' | 'subtotal' | 'discount' | 'vat_rate' | 'vat_amount' | 'total'>) {
  const items = inv.items.length ? inv.items : [blankItem()]
  return items.map((it) => ({
    doc_no: inv.doc_no,
    doc_date: inv.doc_date,
    customer_name: inv.customer_name || '',
    customer_tax_id: inv.customer_tax_id || '',
    customer_address: inv.customer_address || '',
    customer_branch: inv.customer_branch || '',
    sku: it.sku || '',
    description: it.description || '',
    qty: num(it.qty),
    unit: it.unit || '',
    unit_price: num(it.unit_price),
    amount: num(it.amount),
    subtotal: num(inv.subtotal),
    discount: num(inv.discount),
    vat_rate: num(inv.vat_rate),
    vat_amount: num(inv.vat_amount),
    total: num(inv.total),
  }))
}
