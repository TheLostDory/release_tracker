import { api } from '@/lib/api'
import type { ProfileSummary } from '@/types/domain'

/** Everyone who shares a project with the signed-in user (and the user). */
export function listProfiles(): Promise<ProfileSummary[]> {
  return api.get<ProfileSummary[]>('/users')
}

/** Only the signed-in user's own name can be changed. */
export function updateMyName(_id: string, name: string): Promise<void> {
  return api.patch('/me', { name })
}
