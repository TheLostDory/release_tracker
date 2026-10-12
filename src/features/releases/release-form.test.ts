import { describe, expect, it } from 'vitest'
import type { ReleaseInput } from './api'
import { normalizeRelease, targetOutsideSprint, validateRelease } from './release-form'

const valid: ReleaseInput = {
  project_id: 'p1',
  sprint_id: 's1',
  name: 'RC_1',
  version: '1.4.0',
  owner_id: 'u1',
  planned_deployment_date: '2026-10-13',
  description: null,
}

describe('validateRelease', () => {
  it('accepts a complete release', () => {
    expect(validateRelease(valid)).toEqual({})
  })

  it('flags missing required fields', () => {
    const errors = validateRelease({ ...valid, name: '  ', version: '', sprint_id: null, planned_deployment_date: '' })
    // Sprint is optional (projects can work without sprints).
    expect(Object.keys(errors).sort()).toEqual(['name', 'planned_deployment_date', 'version'])
  })
})

describe('normalizeRelease', () => {
  it('trims and nulls blank optionals', () => {
    expect(normalizeRelease({ ...valid, name: ' RC_1 ', owner_id: '', description: '   ' })).toMatchObject({
      name: 'RC_1',
      owner_id: null,
      description: null,
    })
  })
})

describe('targetOutsideSprint', () => {
  const sprint = { start_date: '2026-10-05', end_date: '2026-10-16' }
  it('detects dates outside the sprint', () => {
    expect(targetOutsideSprint('2026-10-13', sprint)).toBe(false)
    expect(targetOutsideSprint('2026-10-16', sprint)).toBe(false)
    expect(targetOutsideSprint('2026-10-19', sprint)).toBe(true)
  })
})
