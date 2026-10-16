import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Gauge, LogOut, Menu, Package, Receipt, Settings, ShoppingCart, Upload, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/messages'
import { useAuth } from '@/features/auth/AuthProvider'
import { LangSwitch, LogoMark } from '@/components/shared'

interface NavItem {
  to: string
  key: MessageKey
  icon: LucideIcon
  adminOnly: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', key: 'nav.dashboard', icon: Gauge, adminOnly: false },
  { to: '/inventory', key: 'nav.inventory', icon: Package, adminOnly: false },
  { to: '/sales', key: 'nav.sales', icon: ShoppingCart, adminOnly: false },
  { to: '/invoices', key: 'nav.invoices', icon: Receipt, adminOnly: false },
  { to: '/import', key: 'nav.import', icon: Upload, adminOnly: true },
  { to: '/team', key: 'nav.team', icon: Users, adminOnly: true },
  { to: '/settings', key: 'nav.settings', icon: Settings, adminOnly: true },
]

function Brand() {
  const { t } = useI18n()
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <span className="min-w-0">
        <span className="block truncate font-heading text-sm font-semibold leading-tight text-white">{t('app.name')}</span>
        <span className="block truncate text-[11px] text-white/55">{t('app.company')}</span>
      </span>
    </div>
  )
}

function Nav({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const { t } = useI18n()
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-white/12 text-white shadow-sm ring-1 ring-white/10' : 'text-white/70 hover:bg-white/8 hover:text-white',
            )
          }
        >
          <item.icon aria-hidden className="h-4 w-4 shrink-0" />
          <span className="truncate">{t(item.key)}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function UserCard() {
  const { t } = useI18n()
  const { profile, signOut } = useAuth()
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <p className="truncate text-sm font-medium text-white">{profile?.full_name || profile?.email}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary">
          {t(profile?.role === 'admin' ? 'role.admin' : 'role.user')}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex min-h-8 items-center gap-1.5 text-[11px] font-medium text-white/70 transition-colors hover:text-white"
        >
          <LogOut aria-hidden className="h-3.5 w-3.5" />
          {t('nav.signOut')}
        </button>
      </div>
    </div>
  )
}

export function AppShell() {
  const { t } = useI18n()
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="no-print hidden w-64 shrink-0 flex-col justify-between bg-sidebar px-4 py-6 lg:flex">
        <div className="space-y-7">
          <Brand />
          <Nav isAdmin={isAdmin} />
        </div>
        <div className="space-y-4">
          <LangSwitch className="w-full justify-center" />
          <UserCard />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 bg-sidebar px-4 py-3 lg:hidden">
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label={t('nav.menu')}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white"
              >
                <Menu aria-hidden className="h-5 w-5" />
              </button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col justify-between overflow-y-auto bg-sidebar px-4 py-6 focus:outline-none">
                <DialogPrimitive.Title className="sr-only">{t('nav.menu')}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">{t('app.company')}</DialogPrimitive.Description>
                <div className="space-y-7">
                  <Brand />
                  <Nav isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
                </div>
                <div className="mt-8 space-y-4">
                  <LangSwitch />
                  <UserCard />
                </div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <span className="truncate font-heading text-sm font-semibold text-white">{t('app.name')}</span>
          <LangSwitch />
        </header>

        <main className="print-only-root mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
