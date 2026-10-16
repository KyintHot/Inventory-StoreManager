import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { LanguageProvider, translateStatic } from '@/lib/i18n'
import { classifyError, shouldRetry } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { LoginPage } from '@/features/auth/LoginPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAdmin, RequireAuth } from '@/components/layout/guards'
import { LoadingState } from '@/components/states'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { InventoryPage } from '@/features/inventory/InventoryPage'
import { SalesPage } from '@/features/sales/SalesPage'
import { InvoicesPage } from '@/features/invoices/InvoicesPage'
import { NotFoundPage } from './NotFoundPage'

// Heavier, admin-only screens load on demand.
const InvoiceDetailPage = lazy(() => import('@/features/invoices/InvoiceDetailPage').then((m) => ({ default: m.InvoiceDetailPage })))
const ImportPage = lazy(() => import('@/features/import/ImportPage').then((m) => ({ default: m.ImportPage })))
const TeamPage = lazy(() => import('@/features/team/TeamPage').then((m) => ({ default: m.TeamPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))

let signingOut = false

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // Expired/revoked session: sign out once; the auth listener clears caches and guards redirect to /login.
      if (classifyError(error) === 'session' && !signingOut) {
        signingOut = true
        toast.error(translateStatic('error.sessionExpired'))
        void supabase.auth.signOut().finally(() => {
          signingOut = false
        })
      }
    },
  }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
  },
})

export function App() {
  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<LoadingState />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route element={<RequireAuth />}>
                  <Route element={<AppShell />}>
                    <Route index element={<DashboardPage />} />
                    <Route path="inventory" element={<InventoryPage />} />
                    <Route path="sales" element={<SalesPage />} />
                    <Route path="invoices" element={<InvoicesPage />} />
                    <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                    <Route element={<RequireAdmin />}>
                      <Route path="import" element={<ImportPage />} />
                      <Route path="team" element={<TeamPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                    </Route>
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
            <Toaster position="top-center" richColors closeButton />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </LanguageProvider>
  )
}

