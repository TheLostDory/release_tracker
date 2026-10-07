import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import type { Database } from '@/types/database'

export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})
