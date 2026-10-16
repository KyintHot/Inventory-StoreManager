import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Download, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { alertCounts, listCategories, listProducts, listRestockProducts, PAGE_SIZE, type StateFilter } from '@/services/products'
import { formatMoney, formatNumber, toIsoDate } from '@/utils/format'
import { downloadXlsx } from '@/utils/exportFile'
import type { Product } from '@/types/database'
import { EmptyState, ErrorState, LoadingState, Spinner } from '@/components/states'
import { PageHeader, StockBadge } from '@/components/shared'
import { FilterLabel, SearchBox } from '@/components/SearchBox'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { EditProductDialog } from './EditProductDialog'

const ALL = 'all'

export function InventoryPage() {
  const { t } = useI18n()
  const { isAdmin } = useAuth()
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(ALL)
  const [state, setState] = useState<StateFilter>(params.get('alerts') ? 'alerts' : 'all')
  const [editing, setEditing] = useState<Product | null>(null)
  const [exporting, setExporting] = useState(false)

  const list = useInfiniteQuery({
    queryKey: ['products', { search, category, state }],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listProducts({ search, category: category === ALL ? '' : category, state }, pageParam),
    getNextPageParam: (last, all) => (last.hasMore ? all.length * PAGE_SIZE : undefined),
  })
  const categories = useQuery({ queryKey: ['product-categories'], queryFn: listCategories })
  const counts = useQuery({ queryKey: ['alert-counts'], queryFn: alertCounts })

  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const c = counts.data ?? { critical: 0, low: 0 }

  async function exportRestock() {
    setExporting(true)
    try {
      const rows = await listRestockProducts()
      if (!rows.length) {
        toast.info(t('inventory.nothingToExport'))
        return
      }
      await downloadXlsx(
        rows.map((p) => ({
          SKU: p.sku,
          [t('inventory.product')]: p.name_th || p.name_en || '',
          [t('inventory.unit')]: p.unit || '',
          [t('inventory.stock')]: Number(p.stock_qty) || 0,
          [t('inventory.min')]: Number(p.min_stock) || 0,
          [t('inventory.restockQty')]: Number(p.restock_qty) || 0,
          [t('inventory.level')]: t(`inventory.state.${p.stock_state}`),
        })),
        t('inventory.restockSheet'),
        `restock-${toIsoDate(new Date())}.xlsx`,
      )
      toast.success(t('inventory.exported'))
    } catch (e) {
      toast.error(errorText(e, t))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('inventory.title')}
        subtitle={t('inventory.subtitle')}
        actions={
          isAdmin ? (
            <Button variant="outline" size="sm" onClick={() => void exportRestock()} disabled={exporting}>
              {exporting ? <Spinner /> : <Download aria-hidden className="h-3.5 w-3.5" />}
              {t('inventory.exportRestock')}
            </Button>
          ) : null
        }
      />

      <Card className="mb-5">
        <CardContent className="grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SearchBox value={search} onCommit={setSearch} placeholder={t('inventory.searchPlaceholder')} label={t('common.search')} />
          <FilterLabel text={t('common.category')}>
            <Select
              aria-label={t('common.category')}
              value={category}
              onValueChange={setCategory}
              options={[{ value: ALL, label: t('common.all') }, ...(categories.data ?? []).map((v) => ({ value: v, label: v }))]}
            />
          </FilterLabel>
          <FilterLabel text={t('inventory.level')}>
            <Select
              aria-label={t('inventory.level')}
              value={state}
              onValueChange={(v) => setState(v as StateFilter)}
              options={[
                { value: 'all', label: t('common.all') },
                { value: 'alerts', label: `${t('inventory.onlyAlerts')} (${c.critical + c.low})` },
                { value: 'critical', label: `${t('inventory.state.critical')} (${c.critical})` },
                { value: 'low', label: `${t('inventory.state.low')} (${c.low})` },
                { value: 'ok', label: t('inventory.state.ok') },
              ]}
            />
          </FilterLabel>
          <div className="flex items-center justify-end text-xs text-muted-foreground" aria-live="polite">
            {list.isPending ? t('common.loading') : `${items.length}${list.hasNextPage ? '+' : ''} ${t('common.of')} ${items.length}${list.hasNextPage ? '+' : ''}`}
          </div>
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
                    <th scope="col" className="px-4 py-3 text-left font-semibold">{t('inventory.sku')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">{t('inventory.product')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">{t('common.category')}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">{t('inventory.price')}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">{t('inventory.stock')}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">{t('inventory.min')}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">{t('inventory.restockQty')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">{t('inventory.level')}</th>
                    {isAdmin ? <th scope="col" className="px-4 py-3"><span className="sr-only">{t('common.edit')}</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      <td className="num px-4 py-3 font-medium">{p.sku}</td>
                      <td className="px-4 py-3">
                        <span className="block">{p.name_th || p.name_en || '—'}</span>
                        {p.name_en && p.name_th ? <span className="block text-xs text-muted-foreground">{p.name_en}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.category || '—'}</td>
                      <td className="num px-4 py-3 text-right">{formatMoney(p.unit_price)}</td>
                      <td className="num px-4 py-3 text-right font-medium">{formatNumber(p.stock_qty)}</td>
                      <td className="num px-4 py-3 text-right text-muted-foreground">{formatNumber(p.min_stock)}</td>
                      <td className="num px-4 py-3 text-right font-semibold text-primary">{Number(p.restock_qty) ? formatNumber(p.restock_qty) : '—'}</td>
                      <td className="px-4 py-3"><StockBadge state={p.stock_state} /></td>
                      {isAdmin ? (
                        <td className="px-4 py-3 text-right">
                          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`${t('inventory.editProduct')} ${p.sku}`} onClick={() => setEditing(p)}>
                            <Pencil aria-hidden className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="space-y-3 p-4 md:hidden">
              {items.map((p) => (
                <li key={p.id} className="rounded-xl border border-border/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name_th || p.name_en || p.sku}</p>
                      <p className="num truncate text-xs text-muted-foreground">{p.sku}</p>
                    </div>
                    <StockBadge state={p.stock_state} />
                  </div>
                  <dl className="num mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{t('inventory.stock')}</dt>
                      <dd className="font-semibold">{formatNumber(p.stock_qty)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('inventory.min')}</dt>
                      <dd className="font-semibold">{formatNumber(p.min_stock)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('inventory.restockQty')}</dt>
                      <dd className="font-semibold text-primary">{formatNumber(p.restock_qty)}</dd>
                    </div>
                  </dl>
                  {isAdmin ? (
                    <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setEditing(p)}>
                      <Pencil aria-hidden className="h-3.5 w-3.5" />
                      {t('inventory.editProduct')}
                    </Button>
                  ) : null}
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

      <EditProductDialog product={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
