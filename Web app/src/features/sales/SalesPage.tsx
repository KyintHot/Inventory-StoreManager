import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { SALES_PAGE_SIZE, listSales, listSalesForExport, salesByCustomer, salesSummary, type SalesFilters } from '@/services/sales'
import { downloadCsv } from '@/utils/exportFile'
import { formatDate, formatMoney, formatNumber, toIsoDate } from '@/utils/format'
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/states'
import { KpiCard, PageHeader } from '@/components/shared'
import { SearchBox } from '@/components/SearchBox'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SalesPage() {
  const { t, lang } = useI18n()
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tab, setTab] = useState('transactions')
  const [exporting, setExporting] = useState(false)
  const filters: SalesFilters = { search, from, to }

  const summary = useQuery({ queryKey: ['sales-summary', filters], queryFn: () => salesSummary(filters) })
  const list = useInfiniteQuery({
    queryKey: ['sales', filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listSales(filters, pageParam),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * SALES_PAGE_SIZE : undefined),
  })
  const customers = useQuery({
    queryKey: ['sales-customers', { from, to }],
    queryFn: () => salesByCustomer({ from, to }),
    enabled: tab === 'customers',
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const s = summary.data

  async function exportCsv() {
    setExporting(true)
    try {
      const rows = await listSalesForExport(filters)
      if (!rows.length) {
        toast.info(t('common.noData'))
        return
      }
      downloadCsv(
        rows.map((r) => ({
          bill_no: r.bill_no,
          sale_date: r.sale_date,
          sku: r.sku,
          product_name: r.product_name,
          qty: r.qty,
          unit: r.unit,
          unit_price: r.unit_price,
          amount: r.amount,
          customer_name: r.customer_name,
        })),
        `sales-${toIsoDate(new Date())}.csv`,
      )
    } catch (e) {
      toast.error(errorText(e, t))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('sales.title')}
        subtitle={t('sales.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? <Spinner /> : <Download aria-hidden className="h-3.5 w-3.5" />}
            {t('sales.exportCsv')}
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label={t('sales.totalRevenue')} value={s ? formatMoney(s.revenue) : '…'} />
        <KpiCard label={t('sales.totalUnits')} value={s ? formatNumber(s.units) : '…'} />
        <KpiCard label={t('sales.bills')} value={s ? formatNumber(s.bills, 0) : '…'} />
      </div>

      <Card className="mb-5">
        <CardContent className="grid items-end gap-3 p-4 sm:grid-cols-3">
          <SearchBox value={search} onCommit={setSearch} placeholder={t('sales.searchPlaceholder')} label={t('common.search')} />
          <Field label={t('sales.dateFrom')}>
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('sales.dateTo')}>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="transactions">{t('sales.tab.transactions')}</TabsTrigger>
          <TabsTrigger value="customers">{t('sales.tab.customers')}</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <Card>
            {list.isPending ? (
              <LoadingState />
            ) : list.error ? (
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-4 py-3 text-left font-semibold">{t('sales.billNo')}</th>
                        <th scope="col" className="px-4 py-3 text-left font-semibold">{t('common.date')}</th>
                        <th scope="col" className="px-4 py-3 text-left font-semibold">{t('sales.product')}</th>
                        <th scope="col" className="px-4 py-3 text-left font-semibold">{t('sales.customer')}</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">{t('sales.qty')}</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">{t('sales.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                          <td className="num px-4 py-3 font-medium">{r.bill_no}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(r.sale_date, lang)}</td>
                          <td className="px-4 py-3">
                            <span className="block">{r.product_name || '—'}</span>
                            <span className="num block text-xs text-muted-foreground">{r.sku}</span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{r.customer_name || '—'}</td>
                          <td className="num px-4 py-3 text-right">{formatNumber(r.qty)}</td>
                          <td className="num px-4 py-3 text-right font-medium">{formatMoney(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="space-y-3 p-4 md:hidden">
                  {items.map((r) => (
                    <li key={r.id} className="rounded-xl border border-border/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{r.product_name || r.sku}</p>
                          <p className="num truncate text-xs text-muted-foreground">
                            {r.bill_no} · {formatDate(r.sale_date, lang)}
                          </p>
                        </div>
                        <span className="num shrink-0 text-sm font-semibold">{formatMoney(r.amount)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {r.customer_name || '—'} · {formatNumber(r.qty)}
                      </p>
                    </li>
                  ))}
                </ul>
                {list.hasNextPage ? (
                  <div className="border-t border-border p-4">
                    <Button variant="outline" className="w-full" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                      {list.isFetchingNextPage ? <Spinner /> : null}
                      {list.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="customers">
          <Card>
            {customers.isPending ? (
              <LoadingState />
            ) : customers.error ? (
              <ErrorState error={customers.error} onRetry={() => void customers.refetch()} />
            ) : customers.data.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t('sales.customersTitle')}</caption>
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-4 py-3 text-left font-semibold">{t('sales.customer')}</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">{t('sales.orders')}</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">{t('sales.totalUnits')}</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">{t('sales.totalRevenue')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.data.map((c) => (
                        <tr key={c.customer_name || 'none'} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3">{c.customer_name || '—'}</td>
                          <td className="num px-4 py-3 text-right">{formatNumber(c.bills, 0)}</td>
                          <td className="num px-4 py-3 text-right">{formatNumber(c.units)}</td>
                          <td className="num px-4 py-3 text-right font-medium">{formatMoney(c.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="space-y-3 p-4 md:hidden">
                  {customers.data.map((c) => (
                    <li key={c.customer_name || 'none'} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.customer_name || '—'}</p>
                        <p className="num text-xs text-muted-foreground">
                          {formatNumber(c.bills, 0)} {t('sales.orders')} · {formatNumber(c.units)}
                        </p>
                      </div>
                      <span className="num shrink-0 text-sm font-semibold">{formatMoney(c.revenue)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
