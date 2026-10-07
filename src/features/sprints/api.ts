import { supabase } from '@/lib/supabase'
import type { Sprint, SprintStatus, SprintWithCount } from '@/types/domain'

export interface SprintInput {
  name: string
  start_date: string
  end_date: string
  status: SprintStatus
}

const SPRINT_COLUMNS = 'id, name, start_date, end_date, status'

/** All sprints, newest first, with release counts (one round trip). */
export async function listSprints(): Promise<SprintWithCount[]> {
  const { data, error } = await supabase
    .from('sprints')
    .select(`${SPRINT_COLUMNS}, releases(count)`)
    .order('start_date', { ascending: false })
  if (error) throw error
  return data.map(({ releases, ...sprint }) => ({ ...sprint, release_count: releases[0]?.count ?? 0 }))
}

export async function createSprint(input: SprintInput): Promise<Sprint> {
  const { data, error } = await supabase.from('sprints').insert(input).select(SPRINT_COLUMNS).single()
  if (error) throw error
  return data
}

export async function updateSprint(id: string, patch: Partial<SprintInput>): Promise<Sprint> {
  const { data, error } = await supabase.from('sprints').update(patch).eq('id', id).select(SPRINT_COLUMNS).single()
  if (error) throw error
  return data
}

export async function deleteSprint(id: string): Promise<void> {
  const { error } = await supabase.from('sprints').delete().eq('id', id)
  if (error) throw error
}
