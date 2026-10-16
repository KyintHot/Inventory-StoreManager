import type { MessageKey } from './messages'

export type ErrorKind = 'forbidden' | 'session' | 'network' | 'conflict' | 'generic'

interface MaybeApiError {
  code?: string
  message?: string
  status?: number
  name?: string
}

/** Classify a Supabase/PostgREST/network error so the UI can say something useful. */
export function classifyError(err: unknown): ErrorKind {
  const e = (err ?? {}) as MaybeApiError
  const msg = (e.message ?? '').toLowerCase()
  if (e.code === '42501' || e.status === 403 || msg.includes('only owners and admins') || msg.includes('permission denied') || msg.includes('row-level security')) {
    return 'forbidden'
  }
  if (e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || msg.includes('jwt expired') || msg.includes('invalid jwt') || msg.includes('not authenticated')) {
    return 'session'
  }
  if (e.code === '23505' || e.code === '23514') return 'conflict'
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) return 'network'
  return 'generic'
}

export function errorMessageKey(err: unknown): MessageKey {
  switch (classifyError(err)) {
    case 'forbidden':
      return 'error.forbidden'
    case 'session':
      return 'error.sessionExpired'
    default:
      return 'error.generic'
  }
}

/** Prefer a specific database message for validation/conflict errors, else a friendly generic one. */
export function errorText(err: unknown, t: (k: MessageKey) => string): string {
  const kind = classifyError(err)
  if (kind === 'conflict') {
    const m = (err as MaybeApiError | undefined)?.message
    if (m) return m
  }
  return t(errorMessageKey(err))
}

export function shouldRetry(failureCount: number, err: unknown): boolean {
  const kind = classifyError(err)
  if (kind === 'forbidden' || kind === 'session' || kind === 'conflict') return false
  return failureCount < 2
}
