// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Authorization/validation branches of the Vercel function that uses the service-role key.
 * The Supabase client is mocked: this verifies OUR checks, not Supabase itself.
 */
const state = {
  user: { id: 'u1' } as { id: string } | null,
  role: 'admin' as string | null,
  inviteError: null as { message: string } | null,
  invited: [] as { email: string; redirectTo: string }[],
  roleUpdates: [] as { id: string; role: string }[],
  serviceKeyUsedFor: [] as string[],
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    if (key === 'service-key') {
      return {
        auth: {
          admin: {
            inviteUserByEmail: async (email: string, opts: { redirectTo: string }) => {
              state.serviceKeyUsedFor.push('invite')
              if (state.inviteError) return { data: { user: null }, error: state.inviteError }
              state.invited.push({ email, redirectTo: opts.redirectTo })
              return { data: { user: { id: 'new-user' } }, error: null }
            },
          },
        },
        from: () => ({
          update: (patch: { role: string }) => ({
            eq: async (_c: string, id: string) => {
              state.roleUpdates.push({ id, role: patch.role })
              return { error: null }
            },
          }),
        }),
      }
    }
    return {
      auth: { getUser: async () => (state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.role ? { role: state.role } : null, error: null }) }) }) }),
    }
  },
}))

import handler from '../../api/invite-user'

function call(opts: { method?: string; token?: string | undefined; body?: unknown; host?: string } = {}) {
  const res = { code: 0, payload: undefined as unknown, headers: {} as Record<string, string> }
  const r = {
    status(c: number) { res.code = c; return r },
    json(b: unknown) { res.payload = b; return r },
    setHeader(n: string, v: string) { res.headers[n] = v; return r },
  }
  const req = {
    method: opts.method ?? 'POST',
    headers: { host: opts.host ?? 'ole.example.com', ...(opts.token === undefined ? { authorization: 'Bearer good' } : opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ?? { email: 'New.Person@Example.com', role: 'user', redirectTo: 'https://ole.example.com/reset-password' },
  }
  return handler(req, r).then(() => res)
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  delete process.env.SITE_URL
  Object.assign(state, { user: { id: 'u1' }, role: 'admin', inviteError: null, invited: [], roleUpdates: [], serviceKeyUsedFor: [] })
})

describe('POST /api/invite-user', () => {
  it('only accepts POST', async () => {
    const r = await call({ method: 'GET' })
    expect(r.code).toBe(405)
    expect(r.headers.Allow).toBe('POST')
  })

  it('refuses when the server is not configured', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect((await call()).code).toBe(500)
  })

  it('rejects requests without a token, never touching the service key', async () => {
    const r = await call({ token: '' })
    expect(r.code).toBe(401)
    expect(state.serviceKeyUsedFor).toHaveLength(0)
  })

  it('rejects an invalid session', async () => {
    state.user = null
    expect((await call()).code).toBe(401)
    expect(state.serviceKeyUsedFor).toHaveLength(0)
  })

  it('rejects staff (non-admin) callers', async () => {
    state.role = 'user'
    const r = await call()
    expect(r.code).toBe(403)
    expect(state.serviceKeyUsedFor).toHaveLength(0)
  })

  it('rejects callers without a profile', async () => {
    state.role = null
    expect((await call()).code).toBe(403)
  })

  it.each([
    [{ email: 'nope', role: 'user', redirectTo: 'https://ole.example.com/x' }],
    [{ email: 'a@b.co', role: 'superuser', redirectTo: 'https://ole.example.com/x' }],
    [{ email: 'a@b.co', redirectTo: 'https://ole.example.com/x' }],
    [{ email: 'a@b.co', role: 'user' }],
  ])('rejects invalid input %j', async (body) => {
    expect((await call({ body })).code).toBe(400)
    expect(state.serviceKeyUsedFor).toHaveLength(0)
  })

  it('refuses a redirect to another host (no open redirect via invites)', async () => {
    const r = await call({ body: { email: 'a@b.co', role: 'user', redirectTo: 'https://evil.example.net/reset-password' } })
    expect(r.code).toBe(400)
    expect(state.invited).toHaveLength(0)
  })

  it('invites a staff member without touching the role', async () => {
    const r = await call()
    expect(r.code).toBe(200)
    expect(state.invited).toEqual([{ email: 'new.person@example.com', redirectTo: 'https://ole.example.com/reset-password' }])
    expect(state.roleUpdates).toHaveLength(0)
  })

  it('promotes to admin only after a successful invite, via trusted code', async () => {
    const r = await call({ body: { email: 'boss@example.com', role: 'admin', redirectTo: 'https://ole.example.com/reset-password' } })
    expect(r.code).toBe(200)
    expect(state.roleUpdates).toEqual([{ id: 'new-user', role: 'admin' }])
  })

  it('allows the configured SITE_URL host', async () => {
    process.env.SITE_URL = 'https://app.ole.co.th'
    const r = await call({ body: { email: 'a@b.co', role: 'user', redirectTo: 'https://app.ole.co.th/reset-password' } })
    expect(r.code).toBe(200)
  })

  it('reports an existing account as 409 and other failures as 502', async () => {
    state.inviteError = { message: 'User already registered' }
    expect((await call()).code).toBe(409)
    state.inviteError = { message: 'smtp down' }
    expect((await call()).code).toBe(502)
    expect(state.roleUpdates).toHaveLength(0)
  })
})
