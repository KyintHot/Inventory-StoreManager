import { supabase } from '@/lib/supabase'
import type { Profile, Role } from '@/types/database'

export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function setRole(id: string, role: Role): Promise<void> {
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw Object.assign(new Error('permission denied'), { code: '42501' })
}

/**
 * Invitations need the Supabase service-role key, which must never reach the browser, so they go
 * through the Vercel function in /api/invite-user (verifies the caller is an admin).
 */
export async function inviteUser(email: string, role: Role): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw Object.assign(new Error('not authenticated'), { status: 401 })
  const res = await fetch('/api/invite-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email, role, redirectTo: `${window.location.origin}/reset-password` }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw Object.assign(new Error(body.error || 'invite failed'), { status: res.status })
  }
}
