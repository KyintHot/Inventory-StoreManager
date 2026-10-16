import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const looksConfigured = (v: string | undefined): v is string => !!v && !v.includes('YOUR-')

/** True when real project values are present. Only the publishable/anon key ever reaches the browser. */
export const isSupabaseConfigured = looksConfigured(url) && looksConfigured(anonKey)

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? url! : 'http://localhost:54321',
  isSupabaseConfigured ? anonKey! : 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)
