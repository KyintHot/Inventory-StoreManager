import Papa from 'papaparse'
import type { Row } from './importMapping'

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
  } catch (e) {
    if (e instanceof FileReadError) throw e
    throw new FileReadError('unreadable')
  }
  // Legacy .xls (binary) is not supported by the maintained reader; ask for .xlsx or .csv.
  throw new FileReadError('unsupported')
}
