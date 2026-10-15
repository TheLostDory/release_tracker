import { describe, expect, it } from 'vitest'
import type { ReleaseDetail, ReleaseTask } from './api'
import { applyApprovalPatch, applyReportPatch, applyTaskPatch, reviewTaskStatus } from './workflow-sync'

const NOW = '2026-10-07T10:00:00.000Z'

const task = (over: Partial<ReleaseTask> = {}): ReleaseTask => ({
  id: 't',
  task_type: 'RC_EMAIL',
  name: 'RC email',
  position: 7,
  status: 'NOT_STARTED',
  planned_date: null,
  completed_at: null,
  owner_id: null,
  notes: null,
  link: null,
  blocker_reason: null,
  ...over,
})

const release = (): ReleaseDetail => ({
  id: 'r',
  name: 'RC_1',
  version: '1',
  description: null,
  planned_deployment_date: '2026-10-13',
  actual_deployment_date: null,
  status_override: null,
  status_override_reason: null,
  created_at: NOW,
  project_id: 'p',
  jira_version_id: null,
  jira_version_name: null,
  sprint: { id: 's', name: 'S', start_date: '2026-10-05', end_date: '2026-10-16' },
  owner: null,
  tasks: [task({ id: 'hit', task_type: 'HIT_REVIEW', name: 'HIT review' }), task({ id: 'ap', task_type: 'APPROVAL', name: 'Approval' })],
  reports: [{ id: 'rep', report_type: 'HIT', status: 'NOT_STARTED', result: 'NOT_REVIEWED', report_url: null, reviewed_at: null, notes: null, reviewer: null }],
  approval: { id: 'a', status: 'PENDING', requested_at: null, approved_at: null, comments: null, approver: null },
})

describe('applyTaskPatch', () => {
  it('stamps and clears completed_at like the DB', () => {
    const completed = applyTaskPatch(task(), { status: 'COMPLETED' }, NOW)
    expect(completed.completed_at).toBe(NOW)
    expect(applyTaskPatch(completed, { status: 'IN_PROGRESS' }, NOW).completed_at).toBeNull()
  })

  it('clears blocker reason when unblocking', () => {
    expect(applyTaskPatch(task({ status: 'BLOCKED', blocker_reason: 'x' }), { status: 'IN_PROGRESS' }, NOW).blocker_reason).toBeNull()
  })
})

describe('report → review step', () => {
  it('maps report state to step status', () => {
    expect(reviewTaskStatus({ status: 'COMPLETED', result: 'PASS' })).toBe('COMPLETED')
    expect(reviewTaskStatus({ status: 'COMPLETED', result: 'WARNING' })).toBe('COMPLETED')
    expect(reviewTaskStatus({ status: 'COMPLETED', result: 'FAIL' })).toBe('BLOCKED')
    expect(reviewTaskStatus({ status: 'SKIPPED', result: 'NOT_REVIEWED' })).toBe('SKIPPED')
    expect(reviewTaskStatus({ status: 'IN_PROGRESS', result: 'NOT_REVIEWED' })).toBe('IN_PROGRESS')
  })

  it('a failed report blocks the HIT review step', () => {
    const next = applyReportPatch(release(), 'rep', { result: 'FAIL' }, NOW)
    expect(next.reports[0]).toMatchObject({ status: 'COMPLETED', reviewed_at: NOW })
    expect(next.tasks[0]).toMatchObject({ status: 'BLOCKED', blocker_reason: 'HIT report failed' })
  })
})

describe('approval → approval step', () => {
  it('approving completes the step', () => {
    const next = applyApprovalPatch(release(), { status: 'APPROVED' }, NOW)
    expect(next.tasks[1]).toMatchObject({ status: 'COMPLETED', completed_at: NOW })
    expect(next.approval?.approved_at).toBe(NOW)
  })
})
