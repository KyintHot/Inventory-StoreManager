import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { INVOICE_PAGE_SIZE, listInvoices, listInvoicesForExport, type InvoiceFilters } from '@/services/invoices'
import { downloadXlsx } from '@/utils/exportFile'
import { formatDate, formatMoney, toIsoDate } from '@/utils/format'
import { invoiceToExportRows } from '@/utils/invoice'
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/states'
import { InvoiceStatusBadge, PageHeader } from '@/components/shared'
import { FilterLabel, SearchBox } from '@/components/SearchBox'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'

export function InvoicesPage() {
  const { t, lang } = useI18n()
  const { isAdmin } = useAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<InvoiceFilters['status']>('all')
  const [exporting, setExporting] = useState(false)
  const filters: InvoiceFilters = { search, status }

  const list = useInfiniteQuery({
    queryKey: ['invoices', filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listInvoices(filters, pageParam),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * INVOICE_PAGE_SIZE : undefined),
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  async function exportAll() {
    setExporting(true)
    try {
      const invoices = await listInvoicesForExport(filters)
      if (!invoices.length) {
        toast.info(t('common.noData'))
        return
      }
      await downloadXlsx(invoices.flatMap(invoiceToExportRows), 'tax-invoices', `tax-invoices-${toIsoDate(new Date())}.xlsx`)
    } catch (e) {
      toast.error(errorText(e, t))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('invoices.title')}
        subtitle={t('invoices.subtitle')}
        actions={
          isAdmin ? (
            <Button variant="outline" size="sm" onClick={() => void exportAll()} disabled={exporting}>
              {exporting ? <Spinner /> : <Download aria-hidden className="h-3.5 w-3.5" />}
              {t('invoices.exportAll')}
            </Button>
          ) : null
        }
      />

      <Card className="mb-5">
        <CardContent className="grid items-end gap-3 p-4 sm:grid-cols-2">
          <SearchBox value={search} onCommit={setSearch} placeholder={t('invoices.searchPlaceholder')} label={t('common.search')} />
          <FilterLabel text={t('common.status')}>
            <Select
              aria-label={t('common.status')}
              value={status}
              onValueChange={(v) => setStatus(v as InvoiceFilters['status'])}
              options={[
                { value: 'all', label: t('common.all') },
                { value: 'imported', label: t('invoices.status.imported') },
                { value: 'edited', label: t('invoices.status.edited') },
                { value: 'exported', label: t('invoices.status.exported') },
              ]}
            />
          </FilterLabel>
        </CardContent>
      </Card>

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
                    <th scope="col" className="px-4 py-3 text-left font-semibold">{t('invoices.docNo')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">{t('common.date')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">{t('invoices.customer')}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">{t('invoices.subtotal')}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">{t('invoices.vat')}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">{t('invoices.grandTotal')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">{t('common.status')}</th>
                    <th scope="col" className="px-4 py-3"><span className="sr-only">{t('invoices.open')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      <td className="num px-4 py-3 font-medium">{inv.doc_no}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.doc_date, lang)}</td>
                      <td className="px-4 py-3">{inv.customer_name || '—'}</td>
                      <td className="num px-4 py-3 text-right">{formatMoney(inv.subtotal)}</td>
                      <td className="num px-4 py-3 text-right text-muted-foreground">{formatMoney(inv.vat_amount)}</td>
                      <td className="num px-4 py-3 text-right font-semibold">{formatMoney(inv.total)}</td>
                      <td className="px-4 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/invoices/${inv.id}`}>{t('invoices.open')}</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 p-4 md:hidden">
              {items.map((inv) => (
                <li key={inv.id}>
                  <Link to={`/invoices/${inv.id}`} className="block rounded-xl border border-border/70 p-3 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="num truncate text-sm font-medium">{inv.doc_no}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {inv.customer_name || '—'} · {formatDate(inv.doc_date, lang)}
                        </p>
                      </div>
                      <span className="num shrink-0 text-sm font-semibold">{formatMoney(inv.total)}</span>
                    </div>
                    <div className="mt-2">
                      <InvoiceStatusBadge status={inv.status} />
                    </div>
                  </Link>
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
    </div>
  )
}
