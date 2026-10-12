import { supabase } from '@/lib/supabase'
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

export async function listMyProjects(userId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, sprints_enabled, enabled_steps, project_members!inner(role)')
    .eq('project_members.user_id', userId)
    .order('name')
  if (error) throw error
  return data.map(({ project_members, ...p }) => ({ ...p, role: project_members[0]!.role }))
}

export async function createProject(input: { name: string; description: string | null; sprintsEnabled: boolean }) {
  const { data, error } = await supabase.rpc('create_project', {
    p_name: input.name,
    p_description: input.description ?? '',
    p_sprints_enabled: input.sprintsEnabled,
  })
  if (error) throw error
  return data
}

export async function updateProject(id: string, patch: Partial<ProjectSettings>): Promise<void> {
  const { error } = await supabase.from('projects').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
}

export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await supabase
    .from('project_members')
    .select('user_id, role, created_at, profile:profiles!project_members_user_id_fkey(id, name, email)')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) throw error
  return data
}

export async function listPendingInvitations(projectId: string): Promise<ProjectInvitation[]> {
  const { data, error } = await supabase
    .from('project_invitations')
    .select('id, role, email, created_at, expires_at, use_count')
    .eq('project_id', projectId)
    .is('revoked_at', null)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function inviteByEmail(projectId: string, email: string, role: ProjectRole): Promise<'added' | 'invited'> {
  const { data, error } = await supabase.rpc('invite_by_email', { p_project: projectId, p_email: email, p_role: role })
  if (error) throw error
  return data === 'added' ? 'added' : 'invited'
}

/** Returns the raw token. It is only shown once; the database stores a hash. */
export async function createInviteLink(projectId: string, role: ProjectRole, expiresInDays: number): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite_link', {
    p_project: projectId,
    p_role: role,
    p_expires_in_days: expiresInDays,
  })
  if (error) throw error
  return data
}

export async function revokeInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invitation', { p_invitation: id })
  if (error) throw error
}

export async function setMemberRole(projectId: string, userId: string, role: ProjectRole): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', { p_project: projectId, p_user: userId, p_role: role })
  if (error) throw error
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { p_project: projectId, p_user: userId })
  if (error) throw error
}

export interface InviteLinkInfo {
  project_id: string
  project_name: string
  role: ProjectRole
  already_member: boolean
}

export async function getInviteLinkInfo(token: string): Promise<InviteLinkInfo | null> {
  const { data, error } = await supabase.rpc('invite_link_info', { p_token: token })
  if (error) throw error
  return data[0] ?? null
}

export async function acceptInviteLink(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invite_link', { p_token: token })
  if (error) throw error
  return data
}
