import { supabase } from '@/lib/supabase'
import type { Product, StockState } from '@/types/database'

export const PAGE_SIZE = 50

export type StateFilter = 'all' | 'alerts' | StockState

export interface ProductFilters {
  search: string
  category: string
  state: StateFilter
}

export interface Page<T> {
  items: T[]
  hasMore: boolean
}

const COLUMNS =
  'id, sku, name_th, name_en, category, unit, unit_price, cost_price, stock_qty, min_stock, restock_qty, stock_state, supplier, is_active'

function filtered(f: ProductFilters) {
  return supabase
    .rpc('products_filtered', { p_search: f.search, p_category: f.category, p_state: f.state })
    .select(COLUMNS)
}

export async function listProducts(f: ProductFilters, offset: number): Promise<Page<Product>> {
  const { data, error } = await filtered(f)
    .order('sku', { ascending: true })
    .range(offset, offset + PAGE_SIZE) // one extra row tells us if there is another page
  if (error) throw error
  const rows = (data ?? []) as unknown as Product[]
  return { items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE }
}

/** Every product needing restock (critical + low), lowest stock first, for the export. */
export async function listRestockProducts(): Promise<Product[]> {
  const all: Product[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await filtered({ search: '', category: '', state: 'alerts' })
      .order('stock_qty', { ascending: true })
      .order('sku', { ascending: true })
      .range(offset, offset + 999)
    if (error) throw error
    const rows = (data ?? []) as unknown as Product[]
    all.push(...rows)
    if (rows.length < 1000) break
  }
  return all
}

export async function listCategories(): Promise<string[]> {
  const { data, error } = await supabase.rpc('product_categories')
  if (error) throw error
  return (data ?? []) as string[]
}

export async function alertCounts(): Promise<{ critical: number; low: number }> {
  const { data, error } = await supabase.rpc('inventory_alert_counts')
  if (error) throw error
  const d = (data ?? {}) as { critical?: number; low?: number }
  return { critical: d.critical ?? 0, low: d.low ?? 0 }
}

export interface ProductEdit {
  name_th: string
  name_en: string
  category: string
  unit: string
  unit_price: number
  stock_qty: number
  min_stock: number
}

export async function updateProduct(id: string, edit: ProductEdit): Promise<void> {
  const { data, error } = await supabase.from('products').update(edit).eq('id', id).select('id')
  if (error) throw error
  // RLS silently filters rows a user may not touch; treat "0 rows" as forbidden, not success.
  if (!data || data.length === 0) throw Object.assign(new Error('permission denied'), { code: '42501' })
}

export interface StockHistoryRow {
  id: number
  old_qty: number | null
  new_qty: number
  delta: number
  source: 'import' | 'manual' | 'initial'
  created_at: string
}

export async function listStockHistory(productId: string): Promise<StockHistoryRow[]> {
  const { data, error } = await supabase
    .from('product_stock_history')
    .select('id, old_qty, new_qty, delta, source, created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? []) as unknown as StockHistoryRow[]
}
