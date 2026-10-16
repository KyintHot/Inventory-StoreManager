import { supabase } from '@/lib/supabase'
import type { DashboardSummary } from '@/types/database'

export async function getDashboard(year: number, month: number): Promise<DashboardSummary> {
  const { data, error } = await supabase.rpc('dashboard_summary', { p_year: year, p_month: month })
  if (error) throw error
  return data as DashboardSummary
}
