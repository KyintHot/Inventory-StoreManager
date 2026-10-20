import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, FileSpreadsheet, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/messages'
import { errorText } from '@/lib/errors'
import { getCompany } from '@/services/settings'
import { ImportPartialError, listRecentImports, recordImport, runImport, type ImportOutcome } from '@/services/imports'
import { parseCometDocument, resolveImportKind } from '@/utils/cometDocument'
import { FIELD_SPECS, autoMap, buildRecords, detectImportKind, type Mapping } from '@/utils/importMapping'
import { FileReadError, readTableFile, type Table } from '@/utils/readTable'
import { formatDate, formatNumber } from '@/utils/format'
import type { ImportKind } from '@/types/database'
import { Spinner } from '@/components/states'
import { PageHeader } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'

const KINDS: { key: ImportKind; label: MessageKey; hint: MessageKey }[] = [
  { key: 'products', label: 'import.type.products', hint: 'import.hint.products' },
  { key: 'sales', label: 'import.type.sales', hint: 'import.hint.sales' },
  { key: 'invoices', label: 'import.type.invoices', hint: 'import.hint.invoices' },
]

const NONE = 'none'

function DropZone({ onFile, label, hint }: { onFile: (f: File) => void; label: string; hint: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          ref.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        over ? 'border-primary bg-primary/5' : 'border-border bg-muted/30 hover:border-primary/40 hover:bg-muted/50',
      )}
    >
      <UploadCloud aria-hidden className="h-7 w-7 text-primary" />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
      <input
        ref={ref}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        data-testid="import-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = '' // allow choosing the same file again
        }}
      />
    </div>
  )
}

export function ImportPage() {
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const [kind, setKind] = useState<ImportKind>('products')
  const [fileName, setFileName] = useState('')
  const [rawTable, setRawTable] = useState<Table | null>(null)
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<{ imported: number; skipped: number; result: ImportOutcome } | null>(null)

  const company = useQuery({ queryKey: ['company'], queryFn: getCompany })
  const logs = useQuery({ queryKey: ['sync-logs'], queryFn: () => listRecentImports(6) })
  const vatRate = Number(company.data?.vat_rate) || 7

  const specs = FIELD_SPECS[kind]
  // Printed Comet5 documents (legacy .xls) are reshaped into rows for the selected kind here;
  // normal tables pass through untouched. Switching kind reshapes the same raw sheet again.
  const table = useMemo(
    () =>
      rawTable ? (kind === 'products' ? rawTable : parseCometDocument(rawTable.rows, kind) ?? rawTable) : null,
    [rawTable, kind],
  )
  const headers = table?.headers ?? []
  const rows = table?.rows ?? []
  const cleaned = !!table && !!rawTable && table !== rawTable
  const built = useMemo(
    () => (mapping && rows.length ? buildRecords(kind, rows, mapping, { vatRate }) : { records: [], problems: [] }),
    [kind, rows, mapping, vatRate],
  )
  const missingRequired = !!mapping && specs.some((f) => f.required && (mapping[f.key] === null || mapping[f.key] === undefined))

  function resetFile() {
    setFileName('')
    setRawTable(null)
    setMapping(null)
    setFileError('')
    setOutcome(null)
    setProgress(null)
  }

  function chooseKind(k: ImportKind) {
    setKind(k)
    setOutcome(null)
    if (rawTable) {
      const next = k === 'products' ? rawTable : parseCometDocument(rawTable.rows, k) ?? rawTable
      setMapping(autoMap(k, next.headers))
    }
  }

  async function onFile(file: File) {
    setReading(true)
    setFileError('')
    setOutcome(null)
    try {
      const loaded = await readTableFile(file)
      // Route the file to the type it fits: a printed invoice dropped while "products" is
      // selected used to yield the raw document grid (16 junk rows, every one "SKU is missing"),
      // and a sales export dropped on "products" imported as products — writing sold quantities
      // into the stock column. Both now switch the type and say so.
      const docKind = resolveImportKind(loaded.rows, kind)
      const activeKind = detectImportKind(loaded.headers, docKind)
      if (activeKind !== kind) {
        setKind(activeKind)
        toast.info(docKind !== kind ? t('import.switchedType') : `${t('import.switchedTo')} ${t(`import.type.${activeKind}`)}`)
      }
      setFileName(file.name)
      setRawTable(loaded)
      const shaped = activeKind === 'products' ? loaded : parseCometDocument(loaded.rows, activeKind) ?? loaded
      setMapping(autoMap(activeKind, shaped.headers))
    } catch (e) {
      resetFile()
      const reason = e instanceof FileReadError ? e.reason : 'unreadable'
      setFileError(
        reason === 'too_large' ? t('import.tooLarge') : reason === 'unsupported' ? t('import.unsupported') : reason === 'empty' ? t('import.noRows') : t('import.readFailed'),
      )
    } finally {
      setReading(false)
    }
  }

  const run = useMutation({
    mutationFn: async () => {
      setProgress({ done: 0, total: built.records.length })
      let result: ImportOutcome
      try {
        result = await runImport(kind, built.records, fileName, (done, total) => setProgress({ done, total }))
      } catch (e) {
        if (e instanceof ImportPartialError) {
          // keep an honest trail of what did get saved before the failure
          await recordImport(kind, fileName, e.done.created + e.done.updated, e.done, built.problems.length, 'partial').catch(() => undefined)
          throw e.cause
        }
        throw e
      }
      await recordImport(kind, fileName, built.records.length, result, built.problems.length)
      return result
    },
    onSuccess: async (result) => {
      setOutcome({ imported: built.records.length, skipped: built.problems.length, result })
      toast.success(t('import.done'))
      await Promise.all(
        ['products', 'alert-counts', 'product-categories', 'dashboard', 'sales', 'sales-summary', 'sales-customers', 'invoices', 'invoice', 'sync-logs'].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      )
    },
    onError: (e) => {
      toast.error(`${t('import.failed')} ${errorText(e, t)}`)
      void qc.invalidateQueries({ queryKey: ['sync-logs'] })
    },
    onSettled: () => setProgress(null),
  })

  const previewFields = specs.filter((f) => mapping && mapping[f.key] !== null && mapping[f.key] !== undefined)
  const kindInfo = KINDS.find((k) => k.key === kind)!

  return (
    <div>
      <PageHeader title={t('import.title')} subtitle={t('import.subtitle')} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>1. {t('import.step.type')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div role="radiogroup" aria-label={t('import.step.type')} className="grid gap-2 sm:grid-cols-3">
                {KINDS.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    role="radio"
                    aria-checked={kind === k.key}
                    onClick={() => chooseKind(k.key)}
                    className={cn(
                      'min-h-11 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      kind === k.key ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40 hover:bg-muted/40',
                    )}
                  >
                    {t(k.label)}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t(kindInfo.hint)}</p>
              <a
                href={`/templates/${kind}.csv`}
                download
                className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Download aria-hidden className="h-3.5 w-3.5" />
                {t('import.template')}
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. {t('import.step.file')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DropZone onFile={(f) => void onFile(f)} label={t('import.drop')} hint={t('import.dropHint')} />
              {fileName ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <FileSpreadsheet aria-hidden className="h-4 w-4 text-primary" />
                  <span className="min-w-0 truncate font-medium">{fileName}</span>
                  <span className="text-muted-foreground">
                    · {formatNumber(rows.length, 0)} {t('import.ready')}
                  </span>
                  {cleaned ? (
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {t('import.cleaned')}
                    </span>
                  ) : null}
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={resetFile}>
                    {t('import.changeFile')}
                  </Button>
                </div>
              ) : null}
              {reading ? (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner /> {t('common.loading')}
                </p>
              ) : null}
              {fileError ? (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {fileError}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {mapping ? (
            <Card>
              <CardHeader>
                <CardTitle>3. {t('import.step.map')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">{t('import.autoMap')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {specs.map((f) => {
                    const v = mapping[f.key]
                    return (
                      <div key={f.key} className="space-y-1.5">
                        <span id={`map-${f.key}`} className="text-xs font-medium text-muted-foreground">
                          {f.label}
                          {f.required ? <span className="text-destructive"> *</span> : null}
                        </span>
                        <Select
                          aria-label={f.label}
                          value={v === null || v === undefined ? NONE : String(v)}
                          onValueChange={(val) => setMapping({ ...mapping, [f.key]: val === NONE ? null : Number(val) })}
                          placeholder={t('import.notMapped')}
                          options={[{ value: NONE, label: t('import.notMapped') }, ...headers.map((h, i) => ({ value: String(i), label: h }))]}
                        />
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {mapping && rows.length ? (
            <Card>
              <CardHeader>
                <CardTitle>4. {t('import.step.preview')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {previewFields.length ? (
                  <div className="overflow-x-auto rounded-lg border border-border/70">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                          {previewFields.map((f) => (
                            <th key={f.key} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                              {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 8).map((r, i) => (
                          <tr key={i} className="border-t border-border/60">
                            {previewFields.map((f) => {
                              const cell = r[mapping[f.key] as number]
                              return (
                                <td key={f.key} className="max-w-[14rem] truncate px-3 py-2">
                                  {cell === '' || cell === undefined || cell === null ? '—' : cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {rows.length > 8 ? (
                  <p className="text-xs text-muted-foreground">
                    8 {t('common.of')} {formatNumber(rows.length, 0)}
                  </p>
                ) : null}

                {built.problems.length ? (
                  <div role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
                    <p className="font-semibold text-warning">
                      {formatNumber(built.problems.length, 0)} {t('import.problems')}
                    </p>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                      {built.problems.slice(0, 30).map((p) => (
                        <li key={p.row}>
                          {t('import.row')} {p.row} — {t(`import.reason.${p.reason}` as MessageKey)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {missingRequired ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('common.required')}: {specs.filter((f) => f.required).map((f) => f.label).join(', ')}
                  </p>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm">
                    <span className="num font-semibold">{formatNumber(built.records.length, 0)}</span> {t('import.ready')}
                    {built.problems.length ? ` · ${formatNumber(built.problems.length, 0)} ${t('import.problems')}` : ''}
                  </p>
                  <Button onClick={() => run.mutate()} disabled={run.isPending || !built.records.length || missingRequired}>
                    {run.isPending ? <Spinner /> : <UploadCloud aria-hidden className="h-4 w-4" />}
                    {run.isPending ? t('import.importing') : t('import.run')}
                  </Button>
                </div>

                {progress ? (
                  <div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                  </div>
                ) : null}

                {outcome ? (
                  <div role="status" className="flex gap-3 rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
                    <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                    <div>
                      <p className="font-semibold text-success">{t('import.done')}</p>
                      <p className="num mt-1 text-muted-foreground">
                        {formatNumber(outcome.imported, 0)} {t('import.rowsImported')} · {formatNumber(outcome.result.created, 0)} {t('import.createdRecords')} ·{' '}
                        {formatNumber(outcome.result.updated, 0)} {t('import.updatedRecords')} · {formatNumber(outcome.skipped, 0)} {t('import.rowsSkipped')}
                        {outcome.result.skippedEdited ? ` · ${formatNumber(outcome.result.skippedEdited, 0)} ${t('import.skippedEdited')}` : ''}
                      </p>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t('import.log')}</CardTitle>
          </CardHeader>
          <CardContent>
            {logs.data && logs.data.length ? (
              <ul className="divide-y divide-border/60">
                {logs.data.map((l) => (
                  <li key={l.id} className="py-2.5 text-sm">
                    <p className="truncate font-medium">{l.file_name || t(`import.type.${l.kind}` as MessageKey)}</p>
                    <p className="num text-xs text-muted-foreground">
                      {t(`import.type.${l.kind}` as MessageKey)} · {formatNumber(l.row_count, 0)} {t('import.rowsImported')} · {formatDate(l.created_at, lang)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">{logs.isPending ? t('common.loading') : t('common.noData')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
