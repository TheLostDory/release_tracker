import { supabase } from '@/lib/supabase'

export interface ReleaseSearchResult {
  id: string
  name: string
  version: string
  sprint_name: string
  owner_name: string | null
  planned_deployment_date: string
  actual_deployment_date: string | null
}

/** Server-side search over release name, version, sprint and owner. */
export async function searchReleases(q: string, signal?: AbortSignal): Promise<ReleaseSearchResult[]> {
  let request = supabase.rpc('search_releases', { q, max_results: 20 })
  if (signal) request = request.abortSignal(signal)
  const { data, error } = await request
  if (error) throw error
  return data
}
