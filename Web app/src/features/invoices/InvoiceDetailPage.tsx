import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Plus, Printer, Save, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { getInvoice, markInvoiceExported, saveInvoice, type InvoiceDraft } from '@/services/invoices'
import { getCompany } from '@/services/settings'
import { downloadXlsx } from '@/utils/exportFile'
import { formatMoney } from '@/utils/format'
import { blankItem, computeInvoiceTotals, invoiceToExportRows, round2 } from '@/utils/invoice'
import type { TaxInvoice } from '@/types/database'
import { ErrorState, LoadingState, Spinner } from '@/components/states'
import { InvoiceStatusBadge } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/input'
import { InvoiceSheet } from './InvoiceSheet'

const numberInput = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? 0 : Number(v)) }

const schema = z.object({
  customer_name: z.string().trim().max(300),
  customer_tax_id: z.string().trim().max(40),
  customer_address: z.string().trim().max(1000),
  customer_branch: z.string().trim().max(120),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z
    .array(
      z.object({
        sku: z.string(),
        description: z.string().trim().max(500),
        qty: z.number().finite(),
        unit: z.string().max(40),
        unit_price: z.number().finite().min(0),
        amount: z.number().finite(),
      }),
    )
    .max(500),
  discount: z.number().finite().min(0),
  vat_rate: z.number().finite().min(0).max(100),
  note: z.string().max(2000),
})
type FormValues = z.infer<typeof schema>

const toFormValues = (inv: TaxInvoice): FormValues => ({
  customer_name: inv.customer_name,
  customer_tax_id: inv.customer_tax_id,
  customer_address: inv.customer_address,
  customer_branch: inv.customer_branch,
  doc_date: inv.doc_date,
  items: inv.items.length ? inv.items.map((i) => ({ ...i })) : [blankItem()],
  discount: Number(inv.discount) || 0,
  vat_rate: Number(inv.vat_rate) || 0,
  note: inv.note,
})

export function InvoiceDetailPage() {
  const { id = '' } = useParams()
  const { t } = useI18n()
  const { isAdmin } = useAuth()
  const qc = useQueryClient()

  const invoiceQ = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(id) })
  const companyQ = useQuery({ queryKey: ['company'], queryFn: getCompany })
  const invoice = invoiceQ.data

  const form = useForm<FormValues>({ resolver: zodResolver(schema) })
  const { register, control, handleSubmit, reset, getValues, setValue, trigger, formState } = form
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })
  const watched = useWatch({ control })

  useEffect(() => {
    if (invoice) reset(toFormValues(invoice))
  }, [invoice, reset])

  const totals = useMemo(
    () => computeInvoiceTotals((watched.items ?? []).map((i) => ({ amount: Number(i?.amount) || 0 })), watched.discount, watched.vat_rate),
    [watched.items, watched.discount, watched.vat_rate],
  )

  function recalc(i: number) {
    const qty = Number(getValues(`items.${i}.qty`)) || 0
    const price = Number(getValues(`items.${i}.unit_price`)) || 0
    setValue(`items.${i}.amount`, round2(qty * price), { shouldDirty: true })
  }

  const draftOf = (v: FormValues): InvoiceDraft => ({ id, ...v })

  const afterSave = async (saved: TaxInvoice) => {
    qc.setQueryData(['invoice', id], saved)
    await qc.invalidateQueries({ queryKey: ['invoices'] })
  }

  const save = useMutation({
    mutationFn: (v: FormValues) => saveInvoice(draftOf(v)),
    onSuccess: async (saved) => {
      await afterSave(saved)
      toast.success(t('invoices.savedOk'))
    },
    onError: (e) => toast.error(errorText(e, t)),
  })

  const exportFile = useMutation({
    mutationFn: async () => {
      if (!(await trigger())) throw Object.assign(new Error('invalid form'), { code: 'FORM' })
      let current = invoice!
      // Export exactly what is stored: save pending edits first so file, screen and database agree.
      if (formState.isDirty) current = await saveInvoice(draftOf(getValues()))
      await downloadXlsx(invoiceToExportRows(current), 'tax-invoice', `${current.doc_no || 'invoice'}.xlsx`)
      return markInvoiceExported(current.id)
    },
    onSuccess: async (saved) => {
      await afterSave(saved)
      toast.success(t('invoices.exportedOk'))
    },
    onError: (e) => {
      if ((e as { code?: string }).code === 'FORM') return
      toast.error(errorText(e, t))
    },
  })

  if (invoiceQ.isPending) return <LoadingState />
  if (invoiceQ.error) return <ErrorState error={invoiceQ.error} onRetry={() => void invoiceQ.refetch()} />
  if (!invoice) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('invoices.notFound')}</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/invoices">{t('common.back')}</Link>
        </Button>
      </div>
    )
  }

  const sheetInvoice = isAdmin
    ? {
        doc_no: invoice.doc_no,
        doc_date: watched.doc_date ?? invoice.doc_date,
        customer_name: watched.customer_name ?? '',
        customer_tax_id: watched.customer_tax_id ?? '',
        customer_address: watched.customer_address ?? '',
        customer_branch: watched.customer_branch ?? '',
        items: (watched.items ?? []).map((i) => ({
          sku: i?.sku ?? '',
          description: i?.description ?? '',
          qty: Number(i?.qty) || 0,
          unit: i?.unit ?? '',
          unit_price: Number(i?.unit_price) || 0,
          amount: Number(i?.amount) || 0,
        })),
        subtotal: totals.subtotal,
        discount: totals.discount,
        vat_rate: totals.vat_rate,
        vat_amount: totals.vat_amount,
        total: totals.total,
        note: watched.note ?? '',
      }
    : invoice

  return (
    <div>
      <div className="no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('common.back')}>
            <Link to="/invoices">
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="num truncate font-heading text-xl font-semibold">{invoice.doc_no}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <InvoiceStatusBadge status={invoice.status} />
              {invoice.edited_by ? <span className="truncate text-xs text-muted-foreground">{invoice.edited_by}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer aria-hidden className="h-3.5 w-3.5" />
            {t('invoices.print')}
          </Button>
          {isAdmin ? (
            <>
              <Button variant="outline" size="sm" onClick={() => exportFile.mutate()} disabled={exportFile.isPending || save.isPending}>
                {exportFile.isPending ? <Spinner /> : <Download aria-hidden className="h-3.5 w-3.5" />}
                {t('invoices.exportFile')}
              </Button>
              <Button size="sm" onClick={handleSubmit((v) => save.mutate(v))} disabled={save.isPending || exportFile.isPending}>
                {save.isPending ? <Spinner /> : <Save aria-hidden className="h-3.5 w-3.5" />}
                {save.isPending ? t('common.loading') : t('common.save')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className={isAdmin ? 'grid gap-5 xl:grid-cols-2' : ''}>
        {isAdmin ? (
          <Card className="no-print">
            <CardContent className="space-y-5 p-4 sm:p-5">
              <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('invoices.customer')} error={formState.errors.customer_name?.message}>
                    <Input {...register('customer_name')} />
                  </Field>
                  <Field label={t('invoices.customerTaxId')}>
                    <Input inputMode="numeric" {...register('customer_tax_id')} />
                  </Field>
                  <Field label={t('invoices.customerBranch')}>
                    <Input {...register('customer_branch')} />
                  </Field>
                  <Field label={t('common.date')} error={formState.errors.doc_date ? t('common.required') : undefined}>
                    <Input type="date" {...register('doc_date')} />
                  </Field>
                  <Field label={t('invoices.customerAddress')} className="sm:col-span-2">
                    <Textarea rows={2} {...register('customer_address')} />
                  </Field>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-heading text-sm font-semibold">{t('invoices.items')}</h2>
                    <Button size="sm" variant="outline" onClick={() => append(blankItem())}>
                      <Plus aria-hidden className="h-3.5 w-3.5" />
                      {t('invoices.addLine')}
                    </Button>
                  </div>
                  <ul className="space-y-3">
                    {fields.map((field, i) => (
                      <li key={field.id} className="rounded-xl border border-border/70 p-3">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                          <Field label={t('invoices.description')} className="col-span-2 sm:col-span-6">
                            <Input {...register(`items.${i}.description`)} />
                          </Field>
                          <Field label={t('invoices.qty')} className="sm:col-span-1">
                            <Input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              data-testid={`item-qty-${i}`}
                              {...register(`items.${i}.qty`, { ...numberInput, onChange: () => recalc(i) })}
                            />
                          </Field>
                          <Field label={t('invoices.unitPrice')} className="sm:col-span-2">
                            <Input type="number" step="any" inputMode="decimal" {...register(`items.${i}.unit_price`, { ...numberInput, onChange: () => recalc(i) })} />
                          </Field>
                          <Field label={t('invoices.amount')} className="sm:col-span-2">
                            <Input type="number" step="any" inputMode="decimal" {...register(`items.${i}.amount`, numberInput)} />
                          </Field>
                          <div className="flex items-end justify-end sm:col-span-1">
                            <Button size="icon" variant="ghost" aria-label={t('invoices.remove')} onClick={() => remove(i)}>
                              <Trash2 aria-hidden className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t('invoices.discount')}>
                    <Input type="number" step="any" inputMode="decimal" {...register('discount', numberInput)} />
                  </Field>
                  <Field label={t('settings.vatRate')}>
                    <Input type="number" step="any" inputMode="decimal" {...register('vat_rate', numberInput)} />
                  </Field>
                  <div className="rounded-xl bg-muted/50 p-3">
                    <span className="text-xs text-muted-foreground">{t('invoices.grandTotal')}</span>
                    <p data-testid="invoice-total" className="num font-heading text-lg font-semibold">
                      {formatMoney(totals.total)}
                    </p>
                  </div>
                </div>

                <Field label={t('invoices.note')}>
                  <Textarea rows={2} {...register('note')} />
                </Field>
                <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
              </form>
            </CardContent>
          </Card>
        ) : null}
        <div className="min-w-0">
          <InvoiceSheet invoice={sheetInvoice} company={companyQ.data ?? null} />
        </div>
      </div>
    </div>
  )
}
