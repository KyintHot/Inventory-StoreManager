import Papa from 'papaparse'

type Cell = string | number | boolean | null | undefined
export type ExportRow = Record<string, Cell>

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Neutralise spreadsheet formula injection: text that starts with = + - @ is prefixed with '. */
export function safeCsvCell(v: Cell): Cell {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return `'${v}`
  return v
}

export function toCsv(rows: ExportRow[]): string {
  const first = rows[0]
  if (!first) return ''
  const fields = Object.keys(first)
  const data = rows.map((r) => fields.map((f) => safeCsvCell(r[f]) ?? ''))
  return Papa.unparse({ fields, data })
}

/** UTF-8 with BOM so Excel opens Thai text correctly. */
export function downloadCsv(rows: ExportRow[], fileName: string): void {
  saveBlob(new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' }), fileName)
}

export async function downloadXlsx(rows: ExportRow[], sheetName: string, fileName: string): Promise<void> {
  const first = rows[0]
  if (!first) return
  const { default: writeXlsx } = await import('write-excel-file/browser')
  const fields = Object.keys(first)
  const header = fields.map((f) => ({ value: f, fontWeight: 'bold' as const }))
  const body = rows.map((r) =>
    fields.map((f) => {
      const v = r[f]
      return v === undefined || v === null || v === '' ? null : v
    }),
  )
  const blob = await writeXlsx([header, ...body], { sheet: sheetName.slice(0, 31) }).toBlob()
  saveBlob(blob, fileName)
}
