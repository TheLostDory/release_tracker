import { api } from '@/lib/api'
import type { Sprint, SprintStatus, SprintWithCount } from '@/types/domain'

export interface SprintInput {
  project_id: string
  name: string
  start_date: string
  end_date: string
  status: SprintStatus
}

export interface SprintDetail extends SprintWithCount {
  project_id: string
}

/** A project's sprints, newest first, with release counts. */
export function listSprints(projectId: string): Promise<SprintWithCount[]> {
  return api.get<SprintWithCount[]>(`/projects/${projectId}/sprints`)
}

export function getSprint(id: string): Promise<SprintDetail> {
  return api.get<SprintDetail>(`/sprints/${id}`)
}

export function createSprint(input: SprintInput): Promise<Sprint> {
  return api.post<Sprint>('/sprints', input)
}

export async function updateSprint(id: string, patch: Partial<Omit<SprintInput, 'project_id'>>): Promise<void> {
  await api.patch(`/sprints/${id}`, patch)
}

export function deleteSprint(id: string): Promise<void> {
  return api.del(`/sprints/${id}`)
}
