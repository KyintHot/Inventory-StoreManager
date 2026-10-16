import { supabase } from '@/lib/supabase'
import type { CustomerSales, SaleLine, SalesSummary } from '@/types/database'
import type { Page } from './products'

export const SALES_PAGE_SIZE = 50

export interface SalesFilters {
  search: string
  from: string // YYYY-MM-DD or ''
  to: string
}

const args = (f: SalesFilters) => ({ p_from: f.from || null, p_to: f.to || null, p_search: f.search })

const COLUMNS = 'id, bill_no, sale_date, sku, product_name, qty, unit, unit_price, amount, customer_name'

export async function listSales(f: SalesFilters, offset: number): Promise<Page<SaleLine>> {
  const { data, error } = await supabase
    .rpc('sales_filtered', args(f))
    .select(COLUMNS)
    .order('sale_date', { ascending: false })
    .order('bill_no', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + SALES_PAGE_SIZE)
  if (error) throw error
  const rows = (data ?? []) as unknown as SaleLine[]
  return { items: rows.slice(0, SALES_PAGE_SIZE), hasMore: rows.length > SALES_PAGE_SIZE }
}

export async function salesSummary(f: SalesFilters): Promise<SalesSummary> {
  const { data, error } = await supabase.rpc('sales_summary', args(f))
  if (error) throw error
  return data as SalesSummary
}

export async function salesByCustomer(f: Pick<SalesFilters, 'from' | 'to'>): Promise<CustomerSales[]> {
  const { data, error } = await supabase.rpc('sales_by_customer', {
    p_from: f.from || null,
    p_to: f.to || null,
    p_limit: 40,
  })
  if (error) throw error
  return ((data ?? []) as CustomerSales[]).map((r) => ({
    customer_name: r.customer_name,
    bills: Number(r.bills),
    units: Number(r.units),
    revenue: Number(r.revenue),
  }))
}

/** Export the filtered lines (capped) as plain rows. */
export async function listSalesForExport(f: SalesFilters, cap = 20000): Promise<SaleLine[]> {
  const all: SaleLine[] = []
  for (let offset = 0; offset < cap; offset += 1000) {
    const { data, error } = await supabase
      .rpc('sales_filtered', args(f))
      .select(COLUMNS)
      .order('sale_date', { ascending: false })
      .order('bill_no', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + 999)
    if (error) throw error
    const rows = (data ?? []) as unknown as SaleLine[]
    all.push(...rows)
    if (rows.length < 1000) break
  }
  return all
}
