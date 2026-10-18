import { describe, expect, it } from 'vitest'
import type { TaskStatus, WorkflowTaskType } from '@/types/domain'
import { buildActionItems, releaseActionItems, type ActionRelease } from './action-items'
import { WORKFLOW_STEPS } from './workflow'

const today = new Date(2026, 9, 7, 9, 0) // Wed Oct 7

type Plan = Partial<Record<WorkflowTaskType, [TaskStatus, string | null, string?]>>

function release(id: string, plan: Plan, over: Partial<ActionRelease> = {}): ActionRelease {
  return {
    id,
    name: id,
    planned_deployment_date: '2026-10-16',
    actual_deployment_date: null,
    status_override: null,
    owner: { id: 'owner' },
    tasks: WORKFLOW_STEPS.map((s) => {
      const [status, planned_date, owner_id] = plan[s.type] ?? ['NOT_STARTED', null]
      return { task_type: s.type, status, planned_date, blocker_reason: null, owner_id: owner_id ?? null }
    }),
    reports: [],
    ...over,
  }
}

const done: [TaskStatus, string] = ['COMPLETED', '2026-10-05']

describe('releaseActionItems', () => {
  it('flags overdue and due-today steps, naming report reviews like people do', () => {
    const items = releaseActionItems(
      release('RC_1', {
        RELEASE_IDENTIFIED: done,
        RC_CREATION: done,
        AUTOMATED_JOBS: done,
        HIT_REVIEW: ['NOT_STARTED', '2026-10-06', 'charbel'],
        LOAD_TEST_REVIEW: ['IN_PROGRESS', '2026-10-07', 'maya'],
      }),
      today,
    )
    expect(items.map((i) => [i.kind, i.title, i.assigneeId])).toEqual([
      ['due_today', 'Load Test report review due today', 'maya'],
      ['overdue', 'HIT report review overdue', 'charbel'],
    ])
  })

  it('reports blocked steps once, even when also overdue', () => {
    const items = releaseActionItems(release('RC_2', { AUTOMATED_JOBS: ['BLOCKED', '2026-10-01'] }), today)
    expect(items.map((i) => i.kind)).toEqual(['blocked'])
  })

  it('waiting for approval is assigned to the approval owner', () => {
    const plan: Plan = Object.fromEntries(WORKFLOW_STEPS.slice(0, 9).map((s) => [s.type, done]))
    plan.APPROVAL = ['IN_PROGRESS', '2026-10-08', 'john']
    const items = releaseActionItems(release('HF_1', plan), today)
    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'awaiting_approval', title: 'Waiting for approval', assigneeId: 'john' }),
    )
  })

  it('upcoming and missed deployments', () => {
    expect(releaseActionItems(release('A', {}, { planned_deployment_date: '2026-10-09' }), today)).toContainEqual(
      expect.objectContaining({ kind: 'deployment_soon', title: 'Target deployment in 2 days', severity: 'info' }),
    )
    expect(releaseActionItems(release('B', {}, { planned_deployment_date: '2026-10-07' }), today)).toContainEqual(
      expect.objectContaining({ title: 'Target deployment today', severity: 'warning' }),
    )
    expect(releaseActionItems(release('C', {}, { planned_deployment_date: '2026-10-05' }), today)).toContainEqual(
      expect.objectContaining({ kind: 'deployment_overdue', severity: 'critical' }),
    )
  })

  it('flags code that does not match Jira, but not a clean or missing check', () => {
    const check = { jira_only: 2, jira_only_done: 1, code_only: 1, no_key: 0, matched: 9, has_jira: true, error: null }
    expect(releaseActionItems(release('A', {}, { code_check: check }), today)).toContainEqual(
      expect.objectContaining({
        id: 'A:code_mismatch',
        kind: 'code_mismatch',
        severity: 'warning',
        title: 'Code doesn’t match Jira (3)',
        detail: '2 in Jira not merged (1 marked Done) · 1 merged not in the version',
      }),
    )
    const kinds = (code_check: ActionRelease['code_check']) => releaseActionItems(release('B', {}, { code_check }), today).map((i) => i.kind)
    expect(kinds({ ...check, jira_only: 0, jira_only_done: 0, code_only: 0 })).not.toContain('code_mismatch')
    expect(kinds(null)).not.toContain('code_mismatch')
  })

  it('released releases need no action', () => {
    expect(
      releaseActionItems(release('R', { AUTOMATED_JOBS: ['BLOCKED', '2026-10-01'] }, { actual_deployment_date: '2026-10-02' }), today),
    ).toEqual([])
  })

  it('ids are stable for the same condition', () => {
    const r = release('RC_1', { HIT_REVIEW: ['NOT_STARTED', '2026-10-06'] })
    expect(releaseActionItems(r, today)[0]?.id).toBe('RC_1:overdue:HIT_REVIEW')
  })
})

describe('buildActionItems', () => {
  it('sorts critical first, then by due date', () => {
    const items = buildActionItems(
      [
        release('A', {}, { planned_deployment_date: '2026-10-09' }), // info
        release('B', { RC_CREATION: ['NOT_STARTED', '2026-10-07'] }), // warning
        release('C', { RC_CREATION: ['NOT_STARTED', '2026-10-03'] }), // critical
      ],
      today,
    )
    expect(items.map((i) => `${i.releaseName}:${i.severity}`)).toEqual(['C:critical', 'B:warning', 'A:info'])
  })
})
