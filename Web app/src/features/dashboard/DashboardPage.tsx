import { lazy, Suspense, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { getDashboard } from '@/services/dashboard'
import { formatDate, formatMoney, formatMonthLabel, formatNumber } from '@/utils/format'
import { targetProgress } from '@/utils/stock'
import type { MessageKey } from '@/lib/messages'
import { ErrorState, LoadingState } from '@/components/states'
import { KpiCard, PageHeader, StockBadge } from '@/components/shared'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const TrendChart = lazy(() => import('./TrendChart'))

export function DashboardPage() {
  const { t, lang } = useI18n()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['dashboard', year, month],
    queryFn: () => getDashboard(year, month),
  })

  const trend = useMemo(
    () => (data?.trend ?? []).map((p) => ({ ...p, label: formatMonthLabel(p.month, lang) })),
    [data, lang],
  )

  if (isPending) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />

  const target = data.target?.target_amount ?? 0
  const progress = targetProgress(data.revenue, target)
  const name = (p: { name_th: string; name_en: string }) => (lang === 'th' ? p.name_th || p.name_en : p.name_en || p.name_th)

  return (
    <div>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t('dashboard.revenue')} value={formatMoney(data.revenue)} />
        <KpiCard label={t('dashboard.units')} value={formatNumber(data.units)} />
        <KpiCard label={t('dashboard.bills')} value={formatNumber(data.bills, 0)} />
        <Link to="/inventory?alerts=1" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <KpiCard label={t('dashboard.alerts')} value={formatNumber(data.alertCount, 0)} to="/inventory?alerts=1" />
        </Link>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t('dashboard.target')}</CardTitle>
          </CardHeader>
          <CardContent>
            {target > 0 ? (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="num font-heading text-xl font-semibold">{progress.pct.toFixed(0)}%</span>
                  <span className="num text-xs text-muted-foreground">{formatMoney(target)}</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.barPct)}
                  aria-label={t('dashboard.target')}
                  className="h-2.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress.barPct}%` }} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">{t('dashboard.achieved')}</dt>
                    <dd className="num font-semibold">{formatMoney(data.revenue)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('dashboard.remaining')}</dt>
                    <dd className="num font-semibold">{formatMoney(progress.remaining)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>{t('dashboard.targetUnset')}</p>
                <Link to="/settings" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  {t('dashboard.setTarget')} <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('dashboard.trend')}</CardTitle>
          </CardHeader>
          <CardContent>
            {trend.length ? (
              <div className="h-56 w-full" role="img" aria-label={t('dashboard.trend')}>
                <Suspense fallback={<LoadingState />}>
                  <TrendChart data={trend} seriesLabel={t('dashboard.revenue')} />
                </Suspense>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">{t('common.noData')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.topSkus')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topSkus.length ? (
              <ol className="divide-y divide-border/60">
                {data.topSkus.map((s, i) => (
                  <li key={s.sku} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{name(s) || s.sku}</p>
                        <p className="num truncate text-xs text-muted-foreground">
                          {s.sku} · {formatNumber(s.qty)} {t('dashboard.sold')}
                        </p>
                      </div>
                    </div>
                    <span className="num shrink-0 text-sm font-semibold">{formatMoney(s.revenue)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('common.noData')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t('dashboard.restock')}</CardTitle>
            {data.alertCount > 0 ? (
              <Link to="/inventory?alerts=1" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {t('dashboard.viewAll')} <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </CardHeader>
          <CardContent>
            {data.alerts.length ? (
              <ul className="divide-y divide-border/60">
                {data.alerts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name(p) || p.sku}</p>
                      <p className="num truncate text-xs text-muted-foreground">
                        {p.sku} · {formatNumber(p.stock_qty)} / {formatNumber(p.min_stock)} {p.unit}
                      </p>
                    </div>
                    <StockBadge state={p.stock_state} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('common.noData')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-5 text-xs text-muted-foreground">
        {t('dashboard.lastSync')}:{' '}
        {data.lastLog
          ? `${t(`import.type.${data.lastLog.kind}` as MessageKey)} · ${data.lastLog.file_name || '—'} · ${formatDate(data.lastLog.created_at, lang)}`
          : t('dashboard.noSync')}
      </p>
    </div>
  )
}

