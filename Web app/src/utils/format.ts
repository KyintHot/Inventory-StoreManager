import type { Lang } from '@/lib/messages'

const toNumber = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Thai baht, e.g. ฿1,234.50. The business is Thai-registered; currency is THB by requirement. */
export function formatMoney(v: unknown): string {
  return `฿${toNumber(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatNumber(v: unknown, maxFraction = 2): string {
  return toNumber(v).toLocaleString('en-US', { maximumFractionDigits: maxFraction })
}

/** Local calendar date as YYYY-MM-DD (not UTC, so late-evening dates do not shift). */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Start/end (inclusive) of a calendar month as YYYY-MM-DD. `month` is 1-12. */
export function monthRange(year: number, month: number): { start: string; end: string } {
  return { start: toIsoDate(new Date(year, month - 1, 1)), end: toIsoDate(new Date(year, month, 0)) }
}

/** Format a date-only string (YYYY-MM-DD) or ISO timestamp. Thai locale shows the Buddhist year. */
export function formatDate(value: string | null | undefined, lang: Lang): string {
  if (!value) return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const d = new Date(dateOnly ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatMonthLabel(yyyyMm: string, lang: Lang): string {
  const d = new Date(`${yyyyMm}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return yyyyMm
  return d.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { month: 'short' })
}
