import type { Database } from '@/types/database'

/**
 * Project roles and what they allow. Mirrors the RLS policies and the
 * membership functions in 20261013000000_projects.sql; the database is the
 * enforcement, this only decides what the UI offers.
 */
export type ProjectRole = Database['public']['Enums']['project_role']

export const ROLE_ORDER: readonly ProjectRole[] = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER']

export const ROLE_LABELS: Record<ProjectRole, string> = {
  VIEWER: 'Viewer',
  MEMBER: 'Member',
  ADMIN: 'Admin',
  OWNER: 'Owner',
}

export const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  VIEWER: 'Read-only access',
  MEMBER: 'Work on releases, sprints, steps, reports and approvals',
  ADMIN: 'Members + project settings and members',
  OWNER: 'Admins + delete the project and manage owners',
}

export function atLeast(role: ProjectRole | null | undefined, min: ProjectRole): boolean {
  return !!role && ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min)
}

export interface Permissions {
  role: ProjectRole | null
  /** Create/edit sprints, releases, steps, reports, approvals. */
  canEdit: boolean
  /** Delete sprints and releases. */
  canDelete: boolean
  /** Project settings, invitations, members below owner. */
  canManage: boolean
  /** Delete the project, manage owners. */
  isOwner: boolean
}

export function permissionsFor(role: ProjectRole | null | undefined): Permissions {
  return {
    role: role ?? null,
    canEdit: atLeast(role, 'MEMBER'),
    canDelete: atLeast(role, 'ADMIN'),
    canManage: atLeast(role, 'ADMIN'),
    isOwner: role === 'OWNER',
  }
}

/** Roles `actor` may give someone who currently has `target` (null = invite). */
export function assignableRoles(actor: ProjectRole | null, target: ProjectRole | null): ProjectRole[] {
  if (!atLeast(actor, 'ADMIN')) return []
  if (target === 'OWNER' && actor !== 'OWNER') return []
  // Invitations never grant owner; existing members can be promoted by owners.
  const ceiling: ProjectRole = target === null ? 'ADMIN' : actor === 'OWNER' ? 'OWNER' : 'ADMIN'
  return ROLE_ORDER.slice(0, ROLE_ORDER.indexOf(ceiling) + 1)
}
