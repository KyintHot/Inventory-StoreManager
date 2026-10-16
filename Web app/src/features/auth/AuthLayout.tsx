import type { ReactNode } from 'react'
import { LogIn } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { LangSwitch } from '@/components/shared'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-4 rounded-full bg-sidebar p-0.5">
        <LangSwitch />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LogIn aria-hidden className="h-5 w-5" />
          </span>
          <h1 className="font-heading text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">{children}</div>
        <p className="mt-5 text-center text-xs text-muted-foreground">{t('app.company')}</p>
      </div>
    </div>
  )
}
