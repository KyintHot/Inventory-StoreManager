import { supabase } from '@/lib/supabase'
import type { ImportKind, SyncLog } from '@/types/database'
import { chunk, type ImportRecord } from '@/utils/importMapping'

export interface ImportOutcome {
  created: number
  updated: number
  skippedEdited: number
}

const RPC: Record<ImportKind, { fn: string; chunkSize: number }> = {
  products: { fn: 'import_products', chunkSize: 500 },
  sales: { fn: 'import_sales', chunkSize: 500 },
  invoices: { fn: 'import_invoices', chunkSize: 100 },
}

/**
 * Sends records in chunks to the admin-only import RPCs. Each chunk is atomic; the RPCs are
 * idempotent, so after a failure the same file can simply be imported again.
 * Throws an ImportPartialError (with progress) if a later chunk fails.
 */
export class ImportPartialError extends Error {
  constructor(public readonly cause: unknown, public readonly done: ImportOutcome) {
    super('Import stopped part-way')
  }
}

export async function runImport(
  kind: ImportKind,
  records: ImportRecord[],
  fileName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  const { fn, chunkSize } = RPC[kind]
  const out: ImportOutcome = { created: 0, updated: 0, skippedEdited: 0 }
  let sent = 0
  for (const part of chunk(records, chunkSize)) {
    const { data, error } = await supabase.rpc(fn, { p_rows: part, p_file_name: fileName })
    if (error) throw new ImportPartialError(error, out)
    const r = (data ?? {}) as { created?: number; updated?: number; skipped_edited?: number }
    out.created += r.created ?? 0
    out.updated += r.updated ?? 0
    out.skippedEdited += r.skipped_edited ?? 0
    sent += part.length
    onProgress?.(sent, records.length)
  }
  return out
}

export async function recordImport(
  kind: ImportKind,
  fileName: string,
  rowCount: number,
  outcome: ImportOutcome,
  skippedRows: number,
  note = '',
): Promise<void> {
  const { error } = await supabase.rpc('record_import', {
    p_kind: kind,
    p_file_name: fileName,
    p_row_count: rowCount,
    p_created: outcome.created,
    p_updated: outcome.updated,
    p_skipped: skippedRows + outcome.skippedEdited,
    p_note: note,
  })
  if (error) throw error
}

export async function listRecentImports(limit = 6): Promise<SyncLog[]> {
  const { data, error } = await supabase
    .from('sync_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as SyncLog[]
}
