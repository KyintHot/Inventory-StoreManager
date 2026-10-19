import Papa from 'papaparse'
import type { Row } from './importMapping'
import { repairSheet } from './cometDocument'

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_ROWS = 100_000

export interface Table {
  headers: string[]
  rows: Row[]
}

export class FileReadError extends Error {
  constructor(public readonly reason: 'too_large' | 'unsupported' | 'empty' | 'unreadable') {
    super(reason)
  }
}

const isBlankRow = (r: unknown[]) => r.every((c) => String(c ?? '').trim() === '')

/** Decode CSV bytes: UTF-8 (with or without BOM) first, then Thai Windows-874 (Comet5 legacy exports). */
export function decodeCsv(buffer: ArrayBuffer): string {
  let text = new TextDecoder('utf-8').decode(buffer)
  if (text.includes('�')) {
    try {
      text = new TextDecoder('windows-874').decode(buffer)
    } catch {
      /* keep the UTF-8 attempt */
    }
  }
  return text.replace(/^﻿/, '')
}

export function tableFromRows(raw: unknown[][]): Table {
  const rows = raw.filter((r) => !isBlankRow(r))
  if (rows.length < 2) throw new FileReadError('empty')
  const headers = rows[0]!.map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`)
  const body = rows.slice(1)
  if (body.length > MAX_ROWS) throw new FileReadError('too_large')
  return { headers, rows: body }
}

export async function readTableFile(file: File): Promise<Table> {
  if (file.size > MAX_FILE_BYTES) throw new FileReadError('too_large')
  const name = file.name.toLowerCase()
  try {
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      const text = decodeCsv(await file.arrayBuffer())
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
      return tableFromRows(parsed.data)
    }
    if (name.endsWith('.xlsx')) {
      const { readSheet } = await import('read-excel-file/browser')
      const data = await readSheet(file)
      return tableFromRows(data as unknown[][])
    }
    if (name.endsWith('.xls')) {
      // Legacy BIFF files (Comet5/Crystal Reports exports): SheetJS reads them, then the
      // CP874 bytes those exports mis-declare are re-decoded (see utils/cometDocument.ts).
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
      if (!sheet) throw new FileReadError('empty')
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][]
      return tableFromRows(repairSheet(data))
    }
  } catch (e) {
    if (e instanceof FileReadError) throw e
    throw new FileReadError('unreadable')
  }
  // Not a format we can read (e.g. .ods, .xlsm) — ask for csv/xls/xlsx.
  throw new FileReadError('unsupported')
}
