import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { InvoiceStatus, StockState } from '@/types/database'
import { Card, CardContent } from '@/components/ui/card'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function KpiCard({ label, value, hint, to }: { label: string; value: ReactNode; hint?: ReactNode; to?: string }) {
  const body = (
    <Card className={cn('h-full', to && 'transition-colors hover:border-primary/40')}>
      <CardContent className="p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="num mt-1.5 font-heading text-2xl font-semibold">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
  return body
}

const STOCK_STYLES: Record<StockState, string> = {
  ok: 'bg-success/10 text-success ring-success/25',
  low: 'bg-warning/10 text-warning ring-warning/30',
  critical: 'bg-destructive/10 text-destructive ring-destructive/30',
}

export function StockBadge({ state }: { state: StockState | null | undefined }) {
  const { t } = useI18n()
  const s: StockState = state && state in STOCK_STYLES ? state : 'ok'
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1', STOCK_STYLES[s])}>
      {t(`inventory.state.${s}`)}
    </span>
  )
}

const INVOICE_STYLES: Record<InvoiceStatus, string> = {
  imported: 'bg-primary/10 text-primary ring-primary/20',
  edited: 'bg-secondary/25 text-primary ring-secondary/40',
  exported: 'bg-success/10 text-success ring-success/25',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus | null | undefined }) {
  const { t } = useI18n()
  const s: InvoiceStatus = status && status in INVOICE_STYLES ? status : 'imported'
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1', INVOICE_STYLES[s])}>
      {t(`invoices.status.${s}`)}
    </span>
  )
}

export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useI18n()
  return (
    <div role="group" aria-label="Language" className={cn('inline-flex items-center rounded-full border border-white/15 bg-white/10 p-0.5', className)}>
      {(['en', 'th'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={cn(
            'min-h-8 rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide transition-colors',
            lang === l ? 'bg-secondary text-secondary-foreground' : 'text-white/70 hover:text-white',
          )}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('h-11 w-11 shrink-0 rounded-xl ring-1 ring-white/15', className)}>
      <rect width="32" height="32" rx="8" fill="#800000" />
      <path d="M16 6l8 4.6v9.2L16 26l-8-6.2v-9.2z" fill="#E9A63A" />
    </svg>
  )
}
