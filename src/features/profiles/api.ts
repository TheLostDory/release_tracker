import { supabase } from '@/lib/supabase'
import type { ProfileSummary } from '@/types/domain'

export async function listProfiles(): Promise<ProfileSummary[]> {
  const { data, error } = await supabase.from('profiles').select('id, name').order('name')
  if (error) throw error
  return data
}

export async function updateMyName(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ name }).eq('id', id)
  if (error) throw error
}
