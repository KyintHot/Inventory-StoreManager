import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { listStockHistory, updateProduct } from '@/services/products'
import { formatDate, formatNumber } from '@/utils/format'
import type { Product } from '@/types/database'
import { Spinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'

export function EditProductDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t, lang } = useI18n()
  const qc = useQueryClient()

  const num = (label: string) => z.number({ invalid_type_error: label })
  const schema = z.object({
    name_th: z.string().trim().max(300),
    name_en: z.string().trim().max(300),
    category: z.string().trim().max(120),
    unit: z.string().trim().max(40),
    unit_price: num(t('common.required')).min(0, t('import.reason.negative')),
    stock_qty: num(t('common.required')), // may be negative in Comet5
    min_stock: num(t('common.required')).min(0, t('import.reason.negative')),
  })
  type Values = z.infer<typeof schema>

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (product) {
      reset({
        name_th: product.name_th ?? '',
        name_en: product.name_en ?? '',
        category: product.category ?? '',
        unit: product.unit ?? '',
        unit_price: Number(product.unit_price) || 0,
        stock_qty: Number(product.stock_qty) || 0,
        min_stock: Number(product.min_stock) || 0,
      })
    }
  }, [product, reset])

  const history = useQuery({
    queryKey: ['stock-history', product?.id],
    queryFn: () => listStockHistory(product!.id),
    enabled: !!product,
  })

  const save = useMutation({
    mutationFn: (v: Values) => updateProduct(product!.id, v),
    onSuccess: async () => {
      toast.success(t('inventory.saved'))
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: ['alert-counts'] }),
        qc.invalidateQueries({ queryKey: ['product-categories'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['stock-history'] }),
      ])
      onClose()
    },
    onError: (e) => toast.error(errorText(e, t)),
  })

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('inventory.editProduct')}</DialogTitle>
          <DialogDescription>{product?.sku}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('inventory.sku')}>
              <Input value={product?.sku ?? ''} disabled readOnly />
            </Field>
            <Field label={t('common.category')} error={errors.category?.message}>
              <Input {...register('category')} />
            </Field>
            <Field label={`${t('inventory.product')} (TH)`} error={errors.name_th?.message} className="sm:col-span-2">
              <Input {...register('name_th')} />
            </Field>
            <Field label={`${t('inventory.product')} (EN)`} error={errors.name_en?.message} className="sm:col-span-2">
              <Input {...register('name_en')} />
            </Field>
            <Field label={t('inventory.price')} error={errors.unit_price?.message}>
              <Input type="number" step="any" inputMode="decimal" aria-invalid={!!errors.unit_price} {...register('unit_price', { valueAsNumber: true })} />
            </Field>
            <Field label={t('inventory.unit')} error={errors.unit?.message}>
              <Input {...register('unit')} />
            </Field>
            <Field label={t('inventory.stockQty')} error={errors.stock_qty?.message}>
              <Input type="number" step="any" inputMode="decimal" aria-invalid={!!errors.stock_qty} {...register('stock_qty', { valueAsNumber: true })} />
            </Field>
            <Field label={t('inventory.minStock')} error={errors.min_stock?.message}>
              <Input type="number" step="any" inputMode="decimal" aria-invalid={!!errors.min_stock} {...register('min_stock', { valueAsNumber: true })} />
            </Field>
          </div>

          <section aria-label={t('history.title')} className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('history.title')}</h3>
            {history.isPending ? (
              <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
            ) : history.data && history.data.length > 0 ? (
              <ul className="max-h-40 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70 text-xs">
                {history.data.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-muted-foreground">
                      {formatDate(h.created_at, lang)} · {t(`history.source.${h.source}`)}
                    </span>
                    <span className="num font-medium">
                      {h.old_qty === null ? '' : `${formatNumber(h.old_qty)} → `}
                      {formatNumber(h.new_qty)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('history.empty')}</p>
            )}
          </section>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              {save.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
