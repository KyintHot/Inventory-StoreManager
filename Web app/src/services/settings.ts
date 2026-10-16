import { supabase } from '@/lib/supabase'
import type { CompanyProfile, MonthlyTarget } from '@/types/database'

export type CompanyForm = Omit<CompanyProfile, 'id' | 'logo_url'>

export async function getCompany(): Promise<CompanyProfile | null> {
  const { data, error } = await supabase.from('company_profile').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  return (data as CompanyProfile | null) ?? null
}

export async function saveCompany(form: CompanyForm): Promise<CompanyProfile> {
  const { data, error } = await supabase
    .from('company_profile')
    .upsert({ id: 1, ...form }, { onConflict: 'id' })
    .select('*')
    .single()
  if (error) throw error
  return data as CompanyProfile
}

export async function listTargets(year: number): Promise<MonthlyTarget[]> {
  const { data, error } = await supabase
    .from('monthly_targets')
    .select('id, year, month, target_amount')
    .eq('year', year)
    .order('month')
  if (error) throw error
  return (data ?? []) as MonthlyTarget[]
}

export async function saveTarget(year: number, month: number, amount: number): Promise<void> {
  const { error } = await supabase.rpc('set_monthly_target', { p_year: year, p_month: month, p_amount: amount })
  if (error) throw error
}

export async function deleteTarget(id: string): Promise<void> {
  const { data, error } = await supabase.from('monthly_targets').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw Object.assign(new Error('permission denied'), { code: '42501' })
}
