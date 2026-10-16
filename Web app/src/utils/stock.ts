import type { StockState } from '@/types/database'

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Quantity to order to get back to the reorder point.
 * Mirrors the `products.restock_qty` generated column (the database is authoritative).
 */
export function restockQty(stock: unknown, minStock: unknown): number {
  return Math.max(0, num(minStock) - num(stock))
}

/**
 * critical: stock <= 20% of reorder point; low: stock <= reorder point; ok otherwise.
 * A reorder point of 0 or less disables alerts. Mirrors `products.stock_state`.
 */
export function stockState(stock: unknown, minStock: unknown): StockState {
  const s = num(stock)
  const m = num(minStock)
  if (m <= 0) return 'ok'
  if (s <= m * 0.2) return 'critical'
  if (s <= m) return 'low'
  return 'ok'
}

/** Achievement of a monthly target, capped for display at 100% but not for the number. */
export function targetProgress(revenue: number, target: number): { pct: number; barPct: number; remaining: number } {
  if (!(target > 0)) return { pct: 0, barPct: 0, remaining: 0 }
  const pct = (revenue / target) * 100
  return { pct, barPct: Math.min(100, Math.max(0, pct)), remaining: Math.max(0, target - revenue) }
}
