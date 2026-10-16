import { Link } from 'react-router-dom'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <p className="font-heading text-5xl font-semibold text-primary">404</p>
      <p className="text-sm text-muted-foreground">{t('error.notFound')}</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">{t('nav.dashboard')}</Link>
      </Button>
    </div>
  )
}
