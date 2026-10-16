import { supabase } from '@/lib/supabase'
import type { InvoiceItem, InvoiceStatus, TaxInvoice } from '@/types/database'
import type { Page } from './products'

export const INVOICE_PAGE_SIZE = 50

export interface InvoiceFilters {
  search: string
  status: 'all' | InvoiceStatus
}

const COLUMNS =
  'id, doc_no, doc_date, customer_name, customer_tax_id, customer_address, customer_branch, items, subtotal, discount, vat_rate, vat_amount, total, note, status, edited_by, edited_at, exported_at'

/** Escape characters that are special inside a PostgREST `or=` filter value. */
function orValue(search: string): string {
  const like = search.replace(/[\\%_]/g, (c) => `\\${c}`)
  return `"%${like.replace(/"/g, '\\"')}%"`
}

function query(f: InvoiceFilters) {
  let q = supabase.from('tax_invoices').select(COLUMNS)
  if (f.status !== 'all') q = q.eq('status', f.status)
  const s = f.search.trim()
  if (s) q = q.or(`doc_no.ilike.${orValue(s)},customer_name.ilike.${orValue(s)}`)
  return q.order('doc_date', { ascending: false }).order('doc_no', { ascending: false })
}

export async function listInvoices(f: InvoiceFilters, offset: number): Promise<Page<TaxInvoice>> {
  const { data, error } = await query(f).range(offset, offset + INVOICE_PAGE_SIZE)
  if (error) throw error
  const rows = (data ?? []) as unknown as TaxInvoice[]
  return { items: rows.slice(0, INVOICE_PAGE_SIZE), hasMore: rows.length > INVOICE_PAGE_SIZE }
}

export async function listInvoicesForExport(f: InvoiceFilters, cap = 5000): Promise<TaxInvoice[]> {
  const all: TaxInvoice[] = []
  for (let offset = 0; offset < cap; offset += 500) {
    const { data, error } = await query(f).range(offset, offset + 499)
    if (error) throw error
    const rows = (data ?? []) as unknown as TaxInvoice[]
    all.push(...rows)
    if (rows.length < 500) break
  }
  return all
}

export async function getInvoice(id: string): Promise<TaxInvoice | null> {
  const { data, error } = await supabase.from('tax_invoices').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as unknown as TaxInvoice | null) ?? null
}

export interface InvoiceDraft {
  id: string
  customer_name: string
  customer_tax_id: string
  customer_address: string
  customer_branch: string
  doc_date: string
  items: InvoiceItem[]
  discount: number
  vat_rate: number
  note: string
}

export async function saveInvoice(d: InvoiceDraft): Promise<TaxInvoice> {
  const { data, error } = await supabase.rpc('save_invoice', {
    p_id: d.id,
    p_customer_name: d.customer_name,
    p_customer_tax_id: d.customer_tax_id,
    p_customer_address: d.customer_address,
    p_customer_branch: d.customer_branch,
    p_doc_date: d.doc_date,
    p_items: d.items,
    p_discount: d.discount,
    p_vat_rate: d.vat_rate,
    p_note: d.note,
  })
  if (error) throw error
  return data as unknown as TaxInvoice
}

export async function markInvoiceExported(id: string): Promise<TaxInvoice> {
  const { data, error } = await supabase.rpc('mark_invoice_exported', { p_id: id })
  if (error) throw error
  return data as unknown as TaxInvoice
}
