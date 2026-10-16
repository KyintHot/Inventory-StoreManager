import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/messages'
import { errorText } from '@/lib/errors'
import { deleteTarget, getCompany, listTargets, saveCompany, saveTarget } from '@/services/settings'
import { formatMoney } from '@/utils/format'
import { ErrorState, LoadingState, Spinner } from '@/components/states'
import { PageHeader } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

const numberInput = { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v)) }

function CompanyCard() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const company = useQuery({ queryKey: ['company'], queryFn: getCompany })

  const schema = z.object({
    name_th: z.string().trim().max(300),
    name_en: z.string().trim().max(300),
    tax_id: z.string().trim().max(40),
    branch: z.string().trim().max(120),
    address: z.string().trim().max(1000),
    phone: z.string().trim().max(60),
    email: z.string().trim().max(200).refine((v) => v === '' || z.string().email().safeParse(v).success, t('auth.emailInvalid')),
    vat_rate: z.number({ invalid_type_error: t('common.required') }).min(0).max(100),
    invoice_note: z.string().max(2000),
  })
  type Values = z.infer<typeof schema>
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (company.isSuccess) {
      const c = company.data
      reset({
        name_th: c?.name_th ?? '',
        name_en: c?.name_en ?? '',
        tax_id: c?.tax_id ?? '',
        branch: c?.branch ?? '',
        address: c?.address ?? '',
        phone: c?.phone ?? '',
        email: c?.email ?? '',
        vat_rate: Number(c?.vat_rate ?? 7),
        invoice_note: c?.invoice_note ?? '',
      })
    }
  }, [company.isSuccess, company.data, reset])

  const save = useMutation({
    mutationFn: (v: Values) => saveCompany(v),
    onSuccess: async (saved) => {
      qc.setQueryData(['company'], saved)
      toast.success(t('settings.savedCompany'))
    },
    onError: (e) => toast.error(errorText(e, t)),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.company')}</CardTitle>
      </CardHeader>
      <CardContent>
        {company.isPending ? (
          <LoadingState />
        ) : company.error ? (
          <ErrorState error={company.error} onRetry={() => void company.refetch()} />
        ) : (
          <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.nameTh')}>
              <Input {...register('name_th')} />
            </Field>
            <Field label={t('settings.nameEn')}>
              <Input {...register('name_en')} />
            </Field>
            <Field label={t('settings.taxId')}>
              <Input inputMode="numeric" {...register('tax_id')} />
            </Field>
            <Field label={t('settings.branch')}>
              <Input {...register('branch')} />
            </Field>
            <Field label={t('settings.address')} className="sm:col-span-2">
              <Textarea rows={2} {...register('address')} />
            </Field>
            <Field label={t('settings.phone')}>
              <Input type="tel" {...register('phone')} />
            </Field>
            <Field label={t('settings.email')} error={errors.email?.message}>
              <Input type="email" aria-invalid={!!errors.email} {...register('email')} />
            </Field>
            <Field label={t('settings.vatRate')} error={errors.vat_rate?.message}>
              <Input type="number" step="any" inputMode="decimal" aria-invalid={!!errors.vat_rate} {...register('vat_rate', numberInput)} />
            </Field>
            <Field label={t('settings.invoiceNote')} className="sm:col-span-2">
              <Textarea rows={2} {...register('invoice_note')} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                {save.isPending ? t('common.loading') : t('settings.saveCompany')}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function TargetsCard() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const targets = useQuery({ queryKey: ['targets', year], queryFn: () => listTargets(year) })

  const schema = z.object({ amount: z.number({ invalid_type_error: t('common.required') }).min(0) })
  type Values = z.infer<typeof schema>
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['targets'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })])

  const save = useMutation({
    mutationFn: (v: Values) => saveTarget(year, month, v.amount),
    onSuccess: async () => {
      reset({ amount: undefined })
      toast.success(t('settings.targetSaved'))
      await refresh()
    },
    onError: (e) => toast.error(errorText(e, t)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteTarget(id),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e, t)),
  })

  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 2 + i)

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{t('settings.targets')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('settings.year')}</span>
            <Select aria-label={t('settings.year')} value={String(year)} onValueChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('settings.month')}</span>
            <Select
              aria-label={t('settings.month')}
              value={String(month)}
              onValueChange={(v) => setMonth(Number(v))}
              options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: t(`month.${i + 1}` as MessageKey) }))}
            />
          </div>
          <Field label={t('settings.targetAmount')} error={errors.amount?.message} className="sm:col-span-2">
            <Input type="number" step="any" min={0} inputMode="decimal" aria-invalid={!!errors.amount} {...register('amount', numberInput)} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              {t('settings.saveTarget')}
            </Button>
          </div>
        </form>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('settings.existingTargets')} · {year}
          </h3>
          {targets.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : targets.error ? (
            <ErrorState error={targets.error} onRetry={() => void targets.refetch()} />
          ) : targets.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {targets.data.map((tg) => (
                <li key={tg.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">{t(`month.${tg.month}` as MessageKey)}</span>
                  <div className="flex items-center gap-2">
                    <span className="num text-sm font-semibold">{formatMoney(tg.target_amount)}</span>
                    <Button size="icon" variant="ghost" aria-label={`${t('settings.remove')} ${t(`month.${tg.month}` as MessageKey)}`} onClick={() => remove.mutate(tg.id)} disabled={remove.isPending}>
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const { t } = useI18n()
  return (
    <div>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="grid gap-5 xl:grid-cols-2">
        <CompanyCard />
        <TargetsCard />
      </div>
    </div>
  )
}
