import { describe, expect, it } from 'vitest'
import type { Sprint } from '@/types/domain'
import { pickDefaultSprint } from './pick-default-sprint'

const sprint = (id: string, start: string, end: string, status: Sprint['status'] = 'PLANNED'): Sprint => ({
  id,
  name: id,
  start_date: start,
  end_date: end,
  status,
})

const today = new Date(2026, 9, 7) // Oct 7, local

describe('pickDefaultSprint', () => {
  it('prefers the ACTIVE sprint', () => {
    const sprints = [sprint('43', '2026-10-19', '2026-10-30', 'ACTIVE'), sprint('42', '2026-10-05', '2026-10-16')]
    expect(pickDefaultSprint(sprints, today)?.id).toBe('43')
  })

  it('falls back to the sprint containing today', () => {
    const sprints = [sprint('43', '2026-10-19', '2026-10-30'), sprint('42', '2026-10-05', '2026-10-16')]
    expect(pickDefaultSprint(sprints, today)?.id).toBe('42')
  })

  it('falls back to the most recent sprint', () => {
    const sprints = [sprint('41', '2026-09-21', '2026-10-02', 'COMPLETED')]
    expect(pickDefaultSprint(sprints, today)?.id).toBe('41')
  })

  it('returns null with no sprints', () => {
    expect(pickDefaultSprint([], today)).toBeNull()
  })
})
