import { createClient } from '@supabase/supabase-js'

// Minimal shapes of the Vercel Node runtime objects (avoids depending on @vercel/node for two types).
interface VercelRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}
interface VercelResponse {
  status(code: number): VercelResponse
  json(body: unknown): VercelResponse
  setHeader(name: string, value: string): VercelResponse
}

/**
 * POST /api/invite-user  { email, role: 'admin' | 'user', redirectTo }
 * Authorization: Bearer <caller's Supabase access token>
 *
 * Runs server-side on Vercel because inviting a user needs the Supabase service-role key, which must
 * never reach the browser. The caller must be a signed-in owner/admin (checked with the caller's own
 * token against the `profiles` table, i.e. through RLS — not with the service key).
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    return res.status(500).json({ error: 'Server is not configured for invitations' })
  }

  const authHeader = req.headers.authorization
  const token = (Array.isArray(authHeader) ? authHeader[0] : authHeader ?? '')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!token) return res.status(401).json({ error: 'Not authenticated' })

  // 1. Who is calling, and are they an admin? (uses the caller's JWT; RLS applies)
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser(token)
  if (userErr || !userData.user) return res.status(401).json({ error: 'Not authenticated' })
  const { data: me, error: meErr } = await asCaller.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (meErr || me?.role !== 'admin') return res.status(403).json({ error: 'Only owners and admins can invite users' })

  // 2. Validate input
  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) as { email?: unknown; role?: unknown; redirectTo?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body?.role === 'admin' ? 'admin' : body?.role === 'user' ? 'user' : null
  if (!EMAIL.test(email) || email.length > 254 || !role) return res.status(400).json({ error: 'A valid email and role are required' })

  // Only allow redirecting back to this deployment (prevents using invites as an open redirect).
  const origin = allowedOrigin(req, body?.redirectTo)
  if (!origin) return res.status(400).json({ error: 'Invalid redirect' })

  // 3. Invite with the service-role client, then set the role. The role is NOT passed as user
  //    metadata (clients can forge metadata); it is written to profiles by this trusted code.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: origin })
  if (inviteErr) {
    const already = /already|registered|exists/i.test(inviteErr.message ?? '')
    if (!already) console.error('[invite-user] invite failed:', inviteErr.message)
    return res.status(already ? 409 : 502).json({ error: already ? 'That email already has an account' : 'Could not send the invitation' })
  }
  // GoTrue answered 200, so the user exists and the email went out — even when the response body
  // carries no user object (observed live on 2026-10-17: invite delivered + accepted, body empty).
  // Demanding `invited.user` here used to turn that success into a false "Could not send" 502 and
  // silently skip the access-level step below. Only `inviteErr` is a failure.
  if (role === 'admin') {
    const id = invited?.user?.id
    const { data: updated, error: roleErr } = id
      ? await admin.from('profiles').update({ role: 'admin' }).eq('id', id).select('id')
      : await admin.from('profiles').update({ role: 'admin' }).eq('email', email).select('id')
    if (roleErr) {
      console.error('[invite-user] role update failed:', roleErr.message)
      return res.status(502).json({ error: 'Invited, but could not set the access level. Change it in Team.' })
    }
    if (!updated?.length) console.warn('[invite-user] invited', email, 'but no profiles row yet — set the access level in Team')
  }
  return res.status(200).json({ ok: true })
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function allowedOrigin(req: VercelRequest, redirectTo: unknown): string | null {
  if (typeof redirectTo !== 'string') return null
  let target: URL
  try {
    target = new URL(redirectTo)
  } catch {
    return null
  }
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const allowedHosts = new Set([String(host ?? '')])
  const extra = process.env.SITE_URL
  if (extra) {
    try {
      allowedHosts.add(new URL(extra).host)
    } catch {
      /* ignore bad SITE_URL */
    }
  }
  return allowedHosts.has(target.host) ? target.toString() : null
}
