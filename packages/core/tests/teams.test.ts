import { describe, expect, it } from 'vitest'
import {
  canAdminTeam,
  canManageTeam,
  canWriteTeam,
  isAssignableTeamRole,
  isTeamRole,
} from '../src/teams.js'

describe('team roles', () => {
  it('recognizes valid roles', () => {
    expect(isTeamRole('owner')).toBe(true)
    expect(isTeamRole('viewer')).toBe(true)
    expect(isTeamRole('guest')).toBe(false)
  })

  it('separates management and ownership', () => {
    expect(canManageTeam('owner')).toBe(true)
    expect(canManageTeam('admin')).toBe(true)
    expect(canManageTeam('member')).toBe(false)
    expect(canManageTeam('viewer')).toBe(false)
    expect(canAdminTeam('owner')).toBe(true)
    expect(canAdminTeam('admin')).toBe(false)
    expect(canWriteTeam('member')).toBe(true)
    expect(canWriteTeam('viewer')).toBe(false)
  })

  it('only allows assigning non-owner roles', () => {
    expect(isAssignableTeamRole('admin')).toBe(true)
    expect(isAssignableTeamRole('member')).toBe(true)
    expect(isAssignableTeamRole('viewer')).toBe(true)
    expect(isAssignableTeamRole('owner')).toBe(false)
  })
})
