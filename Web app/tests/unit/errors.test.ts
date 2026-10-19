import { describe, expect, it } from 'vitest'
import { classifyError, errorText, shouldRetry } from '@/lib/errors'
import { fallbackMessages, type MessageKey } from '@/lib/messages'

const t = (k: MessageKey): string => fallbackMessages[k]!
const GENERIC = fallbackMessages['error.generic']!

/** Shaped like the errors thrown by src/services/team.ts (Error + numeric status). */
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status })

describe('classifyError', () => {
  it('recognises permission and session failures', () => {
    expect(classifyError({ code: '42501' })).toBe('forbidden')
    expect(classifyError({ status: 403 })).toBe('forbidden')
    expect(classifyError({ status: 401 })).toBe('session')
    expect(classifyError(new Error('Failed to fetch'))).toBe('network')
    expect(classifyError({ code: '23505' })).toBe('conflict')
    expect(classifyError(new Error('something else'))).toBe('generic')
  })
})

describe('errorText', () => {
  it('surfaces the invite endpoint’s own message instead of a vague generic', () => {
    // this is the toast the user saw as "something went wrong"
    expect(errorText(apiError(500, 'Server is not configured for invitations'), t))
      .toBe('Server is not configured for invitations')
    expect(errorText(apiError(409, 'That email already has an account'), t))
      .toBe('That email already has an account')
    expect(errorText(apiError(400, 'A valid email and role are required'), t))
      .toBe('A valid email and role are required')
  })

  it('keeps a friendly generic when the error carries no status', () => {
    expect(errorText(new Error('insert into products failed'), t)).toBe(GENERIC)
  })

  it('still maps permission and session errors to their friendly messages', () => {
    expect(errorText(apiError(403, 'Only owners and admins can invite users'), t))
      .toBe(fallbackMessages['error.forbidden'])
    expect(errorText(apiError(401, 'Not authenticated'), t))
      .toBe(fallbackMessages['error.sessionExpired'])
  })

  it('shows the conflict message for duplicate-key errors', () => {
    expect(errorText({ code: '23505', message: 'duplicate key value' }, t)).toBe('duplicate key value')
  })
})

describe('shouldRetry', () => {
  it('does not retry permission, session or conflict failures', () => {
    expect(shouldRetry(1, { status: 403 })).toBe(false)
    expect(shouldRetry(1, { status: 401 })).toBe(false)
    expect(shouldRetry(1, { code: '23505' })).toBe(false)
  })

  it('retries ordinary failures up to twice', () => {
    expect(shouldRetry(1, new Error('boom'))).toBe(true)
    expect(shouldRetry(2, new Error('boom'))).toBe(false)
  })
})
