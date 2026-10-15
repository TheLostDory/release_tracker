import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-context'
import type { ProjectRole } from '@/lib/permissions'
import {
  acceptInviteLink,
  createInviteLink,
  createProject,
  deleteProject,
  getInviteLinkInfo,
  inviteByEmail,
  listMembers,
  listMyProjects,
  listPendingInvitations,
  removeMember,
  revokeInvitation,
  setMemberRole,
  updateProject,
  type ProjectSettings,
} from './api'

export const projectKeys = {
  all: ['projects'] as const,
  mine: (userId: string) => [...projectKeys.all, 'mine', userId] as const,
  members: (projectId: string) => [...projectKeys.all, 'members', projectId] as const,
  invitations: (projectId: string) => [...projectKeys.all, 'invitations', projectId] as const,
  inviteInfo: (token: string) => [...projectKeys.all, 'invite-info', token] as const,
}

export function useMyProjects() {
  const { user } = useAuth()
  return useQuery({
    queryKey: projectKeys.mine(user?.id ?? ''),
    queryFn: listMyProjects,
    enabled: !!user,
    staleTime: 5 * 60_000,
  })
}

export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.members(projectId ?? ''),
    queryFn: () => listMembers(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  })
}

export function usePendingInvitations(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: projectKeys.invitations(projectId ?? ''),
    queryFn: () => listPendingInvitations(projectId!),
    enabled: !!projectId && enabled,
  })
}

export function useInviteLinkInfo(token: string) {
  return useQuery({ queryKey: projectKeys.inviteInfo(token), queryFn: () => getInviteLinkInfo(token), retry: false })
}

/** Membership/project changes can affect almost every query: refresh broadly. */
function useRefreshProjects() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: projectKeys.all })
}

export function useCreateProject() {
  const refresh = useRefreshProjects()
  return useMutation({ mutationFn: createProject, onSuccess: refresh })
}

export function useUpdateProject() {
  const refresh = useRefreshProjects()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ProjectSettings> }) => updateProject(id, patch),
    onSuccess: refresh,
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteProject,
    // Everything cached may belong to the deleted project.
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useInviteByEmail(projectId: string) {
  const refresh = useRefreshProjects()
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: ProjectRole }) => inviteByEmail(projectId, email, role),
    onSuccess: refresh,
  })
}

export function useCreateInviteLink(projectId: string) {
  const refresh = useRefreshProjects()
  return useMutation({
    mutationFn: ({ role, days }: { role: ProjectRole; days: number }) => createInviteLink(projectId, role, days),
    onSuccess: refresh,
  })
}

export function useRevokeInvitation() {
  const refresh = useRefreshProjects()
  return useMutation({ mutationFn: revokeInvitation, onSuccess: refresh })
}

export function useSetMemberRole(projectId: string) {
  const refresh = useRefreshProjects()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) => setMemberRole(projectId, userId, role),
    onSuccess: refresh,
  })
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => removeMember(projectId, userId),
    // Leaving changes what the user can see everywhere.
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useAcceptInviteLink() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: acceptInviteLink, onSuccess: () => qc.invalidateQueries() })
}
