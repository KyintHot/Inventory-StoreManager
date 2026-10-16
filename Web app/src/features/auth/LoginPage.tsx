import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { useAuth } from './AuthProvider'
import { AuthLayout } from './AuthLayout'
import { ConfigMissing, Spinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'

export function LoginPage() {
  const { t } = useI18n()
  const { signIn, session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [formError, setFormError] = useState('')

  const schema = z.object({
    email: z.string().trim().email(t('auth.emailInvalid')),
    password: z.string().min(1, t('common.required')),
  })
  type Values = z.infer<typeof schema>

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })

  if (!isSupabaseConfigured) return <ConfigMissing />
  if (!loading && session && profile) return <Navigate to={from} replace />

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError('')
    try {
      await signIn(email, password)
      navigate(from, { replace: true })
    } catch {
      setFormError(t('auth.invalid')) // deliberately vague: do not reveal whether the email exists
    }
  })

  return (
    <AuthLayout title={t('auth.welcome')} subtitle={t('auth.subtitle')}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label={t('auth.email')} error={errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} placeholder="you@example.com" {...register('email')} />
        </Field>
        <Field label={t('auth.password')} error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
        </Field>
        <div className="text-right">
          <Link to="/forgot-password" className="text-xs font-medium text-primary hover:underline">
            {t('auth.forgot')}
          </Link>
        </div>
        {formError ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {isSubmitting ? t('auth.loggingIn') : t('auth.login')}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t('auth.inviteOnly')}</p>
      </form>
    </AuthLayout>
  )
}
