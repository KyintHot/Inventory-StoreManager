import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { useAuth } from './AuthProvider'
import { AuthLayout } from './AuthLayout'
import { ConfigMissing, LoadingState, Spinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'

/**
 * Landing page for both password-reset emails and staff invitations. The Supabase client turns the
 * link's token into a session on load; if none appears the link is invalid or expired.
 */
export function ResetPasswordPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { session, loading, refreshProfile } = useAuth()
  const [waited, setWaited] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setWaited(true), 2500)
    return () => clearTimeout(id)
  }, [])

  const schema = z
    .object({
      password: z.string().min(8, t('auth.passwordTooShort')),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: t('auth.passwordMismatch') })
  type Values = z.infer<typeof schema>
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } })

  if (!isSupabaseConfigured) return <ConfigMissing />
  if (loading || (!session && !waited)) return <LoadingState />

  if (!session) {
    return (
      <AuthLayout title={t('auth.resetTitle')} subtitle={t('auth.resetInvalidLink')}>
        <Link to="/forgot-password" className="block text-center text-sm font-medium text-primary hover:underline">
          {t('auth.sendLink')}
        </Link>
      </AuthLayout>
    )
  }

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setFormError(error.message || t('error.generic'))
      return
    }
    await refreshProfile()
    toast.success(t('auth.passwordUpdated'))
    navigate('/', { replace: true })
  })

  return (
    <AuthLayout title={t('auth.resetTitle')} subtitle={t('auth.welcomeSetPassword')}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label={t('auth.newPassword')} error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register('password')} />
        </Field>
        <Field label={t('auth.confirmPassword')} error={errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register('confirm')} />
        </Field>
        {formError ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {t('auth.setPassword')}
        </Button>
      </form>
    </AuthLayout>
  )
}
