import { describe, expect, it } from 'vitest'
import type { Sprint } from '@/types/domain'
import { suggestNextSprint, validateSprint } from './sprint-form'

const sprint42: Sprint = { id: '42', name: 'Sprint 42', start_date: '2026-10-05', end_date: '2026-10-16', status: 'ACTIVE' }

describe('suggestNextSprint', () => {
  it('increments the name and starts the next weekday with the same length', () => {
    expect(suggestNextSprint([sprint42])).toEqual({
      name: 'Sprint 43',
      start_date: '2026-10-19', // Fri Oct 16 → Mon Oct 19
      end_date: '2026-10-30',
      status: 'PLANNED',
    })
  })

  it('leaves the name empty when it has no trailing number', () => {
    expect(suggestNextSprint([{ ...sprint42, name: 'Autumn' }]).name).toBe('')
  })

  it('starts today when there are no sprints (weekday)', () => {
    const wed = new Date(2026, 9, 7)
    expect(suggestNextSprint([], wed)).toMatchObject({ name: 'Sprint 1', start_date: '2026-10-07', end_date: '2026-10-18' })
  })
})

describe('validateSprint', () => {
  it('requires fields and ordered dates', () => {
    expect(validateSprint({ name: ' ', start_date: '', end_date: '', status: 'PLANNED' })).toEqual({
      name: 'Name is required.',
      start_date: 'Start date is required.',
      end_date: 'End date is required.',
    })
    expect(
      validateSprint({ name: 'S', start_date: '2026-10-10', end_date: '2026-10-09', status: 'PLANNED' }).end_date,
    ).toBeDefined()
  })
})
