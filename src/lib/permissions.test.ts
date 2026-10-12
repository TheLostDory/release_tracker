import { describe, expect, it } from 'vitest'
import { assignableRoles, atLeast, permissionsFor } from './permissions'

describe('permissionsFor', () => {
  it('maps roles to capabilities', () => {
    expect(permissionsFor('VIEWER')).toMatchObject({ canEdit: false, canDelete: false, canManage: false, isOwner: false })
    expect(permissionsFor('MEMBER')).toMatchObject({ canEdit: true, canDelete: false, canManage: false })
    expect(permissionsFor('ADMIN')).toMatchObject({ canEdit: true, canDelete: true, canManage: true, isOwner: false })
    expect(permissionsFor('OWNER')).toMatchObject({ canManage: true, isOwner: true })
    expect(permissionsFor(null)).toMatchObject({ canEdit: false, role: null })
  })

  it('orders roles', () => {
    expect(atLeast('ADMIN', 'MEMBER')).toBe(true)
    expect(atLeast('MEMBER', 'ADMIN')).toBe(false)
    expect(atLeast(undefined, 'VIEWER')).toBe(false)
  })
})

describe('assignableRoles (mirrors set_member_role / invite rules)', () => {
  it('members and viewers cannot assign anything', () => {
    expect(assignableRoles('MEMBER', 'VIEWER')).toEqual([])
    expect(assignableRoles('VIEWER', null)).toEqual([])
  })

  it('invitations never grant owner', () => {
    expect(assignableRoles('OWNER', null)).toEqual(['VIEWER', 'MEMBER', 'ADMIN'])
    expect(assignableRoles('ADMIN', null)).toEqual(['VIEWER', 'MEMBER', 'ADMIN'])
  })

  it('only owners manage owners', () => {
    expect(assignableRoles('ADMIN', 'OWNER')).toEqual([])
    expect(assignableRoles('ADMIN', 'MEMBER')).toEqual(['VIEWER', 'MEMBER', 'ADMIN'])
    expect(assignableRoles('OWNER', 'MEMBER')).toEqual(['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'])
    expect(assignableRoles('OWNER', 'OWNER')).toEqual(['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'])
  })
})
