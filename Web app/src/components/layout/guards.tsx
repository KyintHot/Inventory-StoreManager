import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/features/auth/AuthProvider'
import { ConfigMissing, LoadingState } from '@/components/states'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared'

/** Everything inside requires a signed-in user with a profile (invite-only company app). */
export function RequireAuth() {
  const { loading, session, profile } = useAuth()
  const location = useLocation()
  if (!isSupabaseConfigured) return <ConfigMissing />
  if (loading) return <LoadingState />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  // Signed in but no profile row (e.g. deleted user): behave as signed out.
  if (!profile) return <Navigate to="/login" replace state={{ noProfile: true }} />
  return <Outlet />
}

/**
 * UI-level admin gate. This is a convenience only: every write/read of protected data is also
 * enforced by Postgres policies and RPC checks.
 */
export function RequireAdmin({ title }: { title?: string }) {
  const { t } = useI18n()
  const { isAdmin } = useAuth()
  if (isAdmin) return <Outlet />
  return (
    <div>
      <PageHeader title={title ?? t('team.title')} />
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">{t('team.adminOnly')}</CardContent>
      </Card>
    </div>
  )
}
