import { useI18n } from '@/lib/i18n'
import { formatDate, formatMoney, formatNumber } from '@/utils/format'
import type { CompanyProfile, InvoiceItem } from '@/types/database'

export interface SheetInvoice {
  doc_no: string
  doc_date: string
  customer_name: string
  customer_tax_id: string
  customer_address: string
  customer_branch: string
  items: InvoiceItem[]
  subtotal: number
  discount: number
  vat_rate: number
  vat_amount: number
  total: number
  note: string
}

/** The printable tax-invoice document (also shown as the on-screen preview). */
export function InvoiceSheet({ invoice, company }: { invoice: SheetInvoice; company: CompanyProfile | null }) {
  const { t, lang } = useI18n()
  const sellerName = lang === 'th' ? company?.name_th || t('app.company') : company?.name_en || company?.name_th || t('app.company')

  return (
    <article aria-label={t('invoices.docTitle')} className="invoice-sheet rounded-xl border border-border p-5 text-[13px] leading-relaxed shadow-sm sm:p-8">
      <header className="flex flex-col gap-4 border-b border-black/15 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="font-heading text-lg font-semibold">{sellerName}</p>
          {company?.address ? <p className="whitespace-pre-line">{company.address}</p> : null}
          {company?.tax_id ? <p>{t('invoices.taxId')}: {company.tax_id}</p> : null}
          {company?.branch ? <p>{company.branch}</p> : null}
          {company?.phone ? <p>{company.phone}</p> : null}
        </div>
        <div className="shrink-0 space-y-0.5 sm:text-right">
          <p className="font-heading text-xl font-semibold">{t('invoices.docTitle')}</p>
          <p className="text-black/60">{t('invoices.original')}</p>
          <p>
            {t('invoices.docNo')}: <span className="num font-medium">{invoice.doc_no || '—'}</span>
          </p>
          <p>
            {t('invoices.issuedOn')}: {formatDate(invoice.doc_date, lang)}
          </p>
        </div>
      </header>

      <section className="grid gap-4 border-b border-black/15 py-5 sm:grid-cols-2">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/55">{t('invoices.buyer')}</p>
          <p className="font-medium">{invoice.customer_name || '—'}</p>
          {invoice.customer_address ? <p className="whitespace-pre-line">{invoice.customer_address}</p> : null}
        </div>
        <div className="space-y-0.5 sm:text-right">
          {invoice.customer_tax_id ? <p>{t('invoices.taxId')}: <span className="num">{invoice.customer_tax_id}</span></p> : null}
          {invoice.customer_branch ? <p>{invoice.customer_branch}</p> : null}
        </div>
      </section>

      <div className="overflow-x-auto">
        <table className="my-5 w-full min-w-[34rem] text-[13px]">
          <thead>
            <tr className="border-b border-black/25 text-left text-xs uppercase tracking-wide text-black/60">
              <th scope="col" className="py-2 pr-2 font-semibold">#</th>
              <th scope="col" className="py-2 pr-2 font-semibold">{t('invoices.item')}</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">{t('invoices.qty')}</th>
              <th scope="col" className="py-2 pr-2 font-semibold">{t('invoices.unit')}</th>
              <th scope="col" className="py-2 pr-2 text-right font-semibold">{t('invoices.unitPrice')}</th>
              <th scope="col" className="py-2 text-right font-semibold">{t('invoices.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.length ? (
              invoice.items.map((it, i) => (
                <tr key={i} className="border-b border-black/10 align-top">
                  <td className="num py-2 pr-2">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <span className="block">{it.description || '—'}</span>
                    {it.sku ? <span className="num block text-xs text-black/55">{it.sku}</span> : null}
                  </td>
                  <td className="num py-2 pr-2 text-right">{formatNumber(it.qty)}</td>
                  <td className="py-2 pr-2">{it.unit || '—'}</td>
                  <td className="num py-2 pr-2 text-right">{formatMoney(it.unit_price)}</td>
                  <td className="num py-2 text-right">{formatMoney(it.amount)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-6 text-center text-black/55">{t('common.noData')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <dl className="num w-full max-w-xs space-y-1">
          <div className="flex justify-between gap-6"><dt>{t('invoices.subtotal')}</dt><dd>{formatMoney(invoice.subtotal)}</dd></div>
          {Number(invoice.discount) ? (
            <div className="flex justify-between gap-6"><dt>{t('invoices.discount')}</dt><dd>-{formatMoney(invoice.discount)}</dd></div>
          ) : null}
          <div className="flex justify-between gap-6"><dt>{t('invoices.vat')} {Number(invoice.vat_rate) || 0}%</dt><dd>{formatMoney(invoice.vat_amount)}</dd></div>
          <div className="flex justify-between gap-6 border-t border-black/25 pt-1.5 font-heading text-base font-semibold"><dt>{t('invoices.grandTotal')}</dt><dd>{formatMoney(invoice.total)}</dd></div>
        </dl>
      </div>

      <footer className="mt-8 grid gap-8 sm:grid-cols-2">
        <p className="whitespace-pre-line text-xs text-black/65">{invoice.note || company?.invoice_note || ''}</p>
        <div className="pt-8 text-center">
          <div className="mx-auto mb-1 w-48 border-b border-black/40" />
          <p className="text-xs text-black/65">{t('invoices.signature')}</p>
        </div>
      </footer>
    </article>
  )
}
