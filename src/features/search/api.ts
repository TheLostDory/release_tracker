import { api, qs } from '@/lib/api'

export interface ReleaseSearchResult {
  id: string
  name: string
  version: string
  project_id: string
  project_name: string
  sprint_name: string | null
  owner_name: string | null
  planned_deployment_date: string
  actual_deployment_date: string | null
}

/** Server-side search over release name, version, project, sprint and owner. */
export function searchReleases(q: string, signal?: AbortSignal): Promise<ReleaseSearchResult[]> {
  return api.get<ReleaseSearchResult[]>(`/search${qs({ q })}`, signal)
}
