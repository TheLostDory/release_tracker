import { describe, expect, it } from 'vitest'
import type { TaskStatus, WorkflowTaskType } from '@/types/domain'
import { buildCalendarEvents, detectConflicts, groupByDay, type EventRelease } from './calendar-events'

const today = new Date(2026, 9, 7, 9) // Oct 7

type T = [WorkflowTaskType, TaskStatus, string | null, (string | null)?, (string | null)?]

function release(id: string, target: string, tasks: T[], deployed: string | null = null): EventRelease {
  return {
    id,
    name: id,
    planned_deployment_date: target,
    actual_deployment_date: deployed,
    owner: { id: 'lead' },
    tasks: tasks.map(([task_type, status, planned_date, completed_at = null, owner_id = null]) => ({
      task_type,
      status,
      planned_date,
      completed_at,
      owner_id,
    })),
  }
}

describe('buildCalendarEvents', () => {
  const events = buildCalendarEvents(
    [
      release('RC_1', '2026-10-13', [
        ['RC_CREATION', 'COMPLETED', '2026-10-05', new Date(2026, 9, 6, 15).toISOString()],
        ['AUTOMATED_JOBS', 'IN_PROGRESS', '2026-10-06'],
        ['LOAD_TEST_REVIEW', 'NOT_STARTED', '2026-10-07'],
        ['LONGEVITY_REVIEW', 'SKIPPED', '2026-10-08'],
        ['HIT_REVIEW', 'NOT_STARTED', null],
        ['DEPLOYMENT', 'NOT_STARTED', '2026-10-13'],
      ]),
    ],
    today,
  )
  const byId = Object.fromEntries(events.map((e) => [e.id, e]))

  it('places completed steps on their completion day', () => {
    expect(byId['RC_1:RC_CREATION']).toMatchObject({ day: '2026-10-06', state: 'done' })
  })

  it('marks open steps overdue / today / open', () => {
    expect(byId['RC_1:AUTOMATED_JOBS']?.state).toBe('overdue')
    expect(byId['RC_1:LOAD_TEST_REVIEW']?.state).toBe('today')
  })

  it('omits skipped and undated steps, and represents deployment by the target marker', () => {
    expect(byId['RC_1:LONGEVITY_REVIEW']).toBeUndefined()
    expect(byId['RC_1:HIT_REVIEW']).toBeUndefined()
    expect(byId['RC_1:DEPLOYMENT']).toBeUndefined()
    expect(byId['RC_1:target']).toMatchObject({ day: '2026-10-13', kind: 'target', state: 'open' })
  })

  it('uses the actual date once deployed', () => {
    const [target] = buildCalendarEvents([release('R', '2026-10-01', [], '2026-10-02')], today)
    expect(target).toMatchObject({ day: '2026-10-02', label: 'Deployed', state: 'done' })
  })
})

describe('detectConflicts', () => {
  it('flags same-day deployments and one owner across releases', () => {
    const events = buildCalendarEvents(
      [
        release('RC_1', '2026-10-16', [['HIT_REVIEW', 'NOT_STARTED', '2026-10-10', null, 'charbel']]),
        release('RC_2', '2026-10-16', [['RC_EMAIL', 'NOT_STARTED', '2026-10-10', null, 'charbel']]),
      ],
      today,
    )
    const conflicts = detectConflicts(groupByDay(events), (id) => (id === 'charbel' ? 'Charbel' : id))
    expect(conflicts.get('2026-10-16')).toEqual([{ kind: 'deployments', message: 'RC_1, RC_2 all deploy on this day' }])
    expect(conflicts.get('2026-10-10')).toEqual([{ kind: 'owner', message: 'Charbel has work on RC_1, RC_2' }])
  })

  it('ignores completed work', () => {
    const events = buildCalendarEvents(
      [
        release('A', '2026-10-20', [['RC_EMAIL', 'COMPLETED', '2026-10-05', new Date(2026, 9, 5, 12).toISOString(), 'x']]),
        release('B', '2026-10-21', [['RC_EMAIL', 'NOT_STARTED', '2026-10-05', null, 'x']]),
      ],
      today,
    )
    expect(detectConflicts(groupByDay(events)).size).toBe(0)
  })
})
