import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { AuthLayout } from './AuthLayout'
import { ConfigMissing, Spinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'

export function ForgotPasswordPage() {
  const { t } = useI18n()
  const [sent, setSent] = useState(false)
  const [formError, setFormError] = useState('')
  const schema = z.object({ email: z.string().trim().email(t('auth.emailInvalid')) })
  type Values = z.infer<typeof schema>
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  if (!isSupabaseConfigured) return <ConfigMissing />

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    // Same message whether or not the account exists (no account enumeration). Only surface
    // transport/rate-limit problems.
    if (error && error.status !== 400 && error.status !== 422) {
      setFormError(t('error.generic'))
      return
    }
    setSent(true)
  })

  return (
    <AuthLayout title={t('auth.resetTitle')} subtitle={t('auth.resetSubtitle')}>
      {sent ? (
        <div className="space-y-4 text-sm">
          <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-success">
            {t('auth.linkSent')}
          </p>
          <Link to="/login" className="block text-center font-medium text-primary hover:underline">
            {t('auth.backToLogin')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field label={t('auth.email')} error={errors.email?.message}>
            <Input type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} {...register('email')} />
          </Field>
          {formError ? (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            {t('auth.sendLink')}
          </Button>
          <Link to="/login" className="block text-center text-sm font-medium text-primary hover:underline">
            {t('auth.backToLogin')}
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}
