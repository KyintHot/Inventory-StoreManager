import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'
import { errorText } from '@/lib/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { inviteUser, listProfiles, setRole } from '@/services/team'
import type { Role } from '@/types/database'
import { ErrorState, LoadingState, Spinner } from '@/components/states'
import { PageHeader } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

export function TeamPage() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const qc = useQueryClient()

  const people = useQuery({ queryKey: ['profiles'], queryFn: listProfiles })

  const schema = z.object({
    email: z.string().trim().min(1, t('team.needEmail')).email(t('auth.emailInvalid')),
    role: z.enum(['user', 'admin']),
  })
  type Values = z.infer<typeof schema>
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', role: 'user' } })

  const invite = useMutation({
    mutationFn: (v: Values) => inviteUser(v.email, v.role),
    onSuccess: async () => {
      toast.success(t('team.invited'))
      reset({ email: '', role: 'user' })
      await qc.invalidateQueries({ queryKey: ['profiles'] })
    },
    onError: (e) => toast.error(errorText(e, t)),
  })

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => setRole(id, role),
    onSuccess: async () => {
      toast.success(t('team.roleChanged'))
      await qc.invalidateQueries({ queryKey: ['profiles'] })
    },
    onError: (e) => toast.error(errorText(e, t)),
  })

  const roleOptions = [
    { value: 'user', label: t('role.user') },
    { value: 'admin', label: t('role.admin') },
  ]

  return (
    <div>
      <PageHeader title={t('team.title')} subtitle={t('team.subtitle')} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t('team.invite')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => invite.mutate(v))} noValidate className="space-y-4">
              <Field label={t('team.email')} error={errors.email?.message}>
                <Input type="email" inputMode="email" autoComplete="off" placeholder="name@example.com" aria-invalid={!!errors.email} {...register('email')} />
              </Field>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('team.role')}</span>
                <Select
                  aria-label={t('team.role')}
                  value={watch('role')}
                  onValueChange={(v) => setValue('role', v as Role)}
                  options={[
                    { value: 'user', label: t('team.role.user') },
                    { value: 'admin', label: t('team.role.admin') },
                  ]}
                />
              </div>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? <Spinner /> : <UserPlus aria-hidden className="h-4 w-4" />}
                {invite.isPending ? t('common.loading') : t('team.send')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('team.members')}</CardTitle>
          </CardHeader>
          <CardContent>
            {people.isPending ? (
              <LoadingState />
            ) : people.error ? (
              <ErrorState error={people.error} onRetry={() => void people.refetch()} />
            ) : people.data.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('common.noData')}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {people.data.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {p.full_name || p.email}
                        {profile?.id === p.id ? <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase">{t('team.you')}</span> : null}
                      </p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Mail aria-hidden className="h-3 w-3 shrink-0" />
                        {p.email}
                      </p>
                    </div>
                    {profile?.id === p.id ? (
                      <span className="text-xs font-semibold text-primary">{t('role.admin')}</span>
                    ) : (
                      <div className="w-full sm:w-44">
                        <Select
                          aria-label={`${t('team.role')}: ${p.email}`}
                          value={p.role}
                          onValueChange={(role) => changeRole.mutate({ id: p.id, role: role as Role })}
                          options={roleOptions}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
