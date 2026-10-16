import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn('h-4 w-4 animate-spin', className)} />
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n()
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Spinner />
      {label ?? t('common.loading')}
    </div>
  )
}

export function EmptyState({ message, action }: { message?: string; action?: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
      <Inbox aria-hidden className="h-6 w-6 opacity-50" />
      <p>{message ?? t('common.noData')}</p>
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n()
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center text-sm">
      <AlertTriangle aria-hidden className="h-6 w-6 text-destructive" />
      <p className="text-destructive">{errorText(error, t)}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  )
}

export function ConfigMissing() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div role="alert" className="max-w-md rounded-xl border border-destructive/30 bg-card p-6 text-sm shadow-sm">
        <p className="font-heading text-base font-semibold text-destructive">Ole Hardware</p>
        <p className="mt-2 text-muted-foreground">{t('error.notConfigured')}</p>
      </div>
    </div>
  )
}
