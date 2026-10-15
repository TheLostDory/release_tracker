import { api } from '@/lib/api'
import { isNotFound } from '@/lib/errors'
import type { ProjectRole } from '@/lib/permissions'
import type { WorkflowTaskType } from '@/types/domain'

export interface Project {
  id: string
  name: string
  description: string | null
  sprints_enabled: boolean
  enabled_steps: WorkflowTaskType[]
  /** The signed-in user's role in this project. */
  role: ProjectRole
}

export interface ProjectSettings {
  name: string
  description: string | null
  sprints_enabled: boolean
  enabled_steps: WorkflowTaskType[]
}

export interface ProjectMember {
  user_id: string
  role: ProjectRole
  created_at: string
  profile: { id: string; name: string; email: string } | null
}

export interface ProjectInvitation {
  id: string
  role: ProjectRole
  /** Email invite when set; otherwise a shareable link. */
  email: string | null
  created_at: string
  expires_at: string | null
  use_count: number
}

export function listMyProjects(): Promise<Project[]> {
  return api.get<Project[]>('/projects')
}

export async function createProject(input: { name: string; description: string | null; sprintsEnabled: boolean }) {
  const { id } = await api.post<{ id: string }>('/projects', input)
  return id
}

export function updateProject(id: string, patch: Partial<ProjectSettings>): Promise<void> {
  return api.patch(`/projects/${id}`, patch)
}

export function deleteProject(id: string): Promise<void> {
  return api.del(`/projects/${id}`)
}

export function listMembers(projectId: string): Promise<ProjectMember[]> {
  return api.get<ProjectMember[]>(`/projects/${projectId}/members`)
}

export function listPendingInvitations(projectId: string): Promise<ProjectInvitation[]> {
  return api.get<ProjectInvitation[]>(`/projects/${projectId}/invitations`)
}

export async function inviteByEmail(projectId: string, email: string, role: ProjectRole): Promise<'added' | 'invited'> {
  const { result } = await api.post<{ result: string }>(`/projects/${projectId}/invitations/email`, { email, role })
  return result === 'added' ? 'added' : 'invited'
}

/** Returns the raw token. It is only shown once; the database stores a hash. */
export async function createInviteLink(projectId: string, role: ProjectRole, expiresInDays: number): Promise<string> {
  const { token } = await api.post<{ token: string }>(`/projects/${projectId}/invitations/link`, { role, days: expiresInDays })
  return token
}

export function revokeInvitation(id: string): Promise<void> {
  return api.del(`/invitations/${id}`)
}

export function setMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<void> {
  return api.put(`/projects/${projectId}/members/${userId}`, { role })
}

export function removeMember(projectId: string, userId: string): Promise<void> {
  return api.del(`/projects/${projectId}/members/${userId}`)
}

export interface InviteLinkInfo {
  project_id: string
  project_name: string
  role: ProjectRole
  already_member: boolean
}

export async function getInviteLinkInfo(token: string): Promise<InviteLinkInfo | null> {
  try {
    return await api.get<InviteLinkInfo>(`/invites/${encodeURIComponent(token)}`)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function acceptInviteLink(token: string): Promise<string> {
  const { projectId } = await api.post<{ projectId: string }>(`/invites/${encodeURIComponent(token)}/accept`)
  return projectId
}
