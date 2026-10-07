import { describe, expect, it } from 'vitest'
import type { TaskStatus, WorkflowTaskType } from '@/types/domain'
import { computeReleaseStatus, nextAction, type StatusInput, type StatusReport, type StatusTask } from './release-status'
import { WORKFLOW_STEPS } from './workflow'

const today = new Date(2026, 9, 7, 10, 0) // Wed Oct 7, local

type Plan = Partial<Record<WorkflowTaskType, [TaskStatus, string | null]>>

/** All 12 steps; unspecified ones NOT_STARTED with no date. */
function tasks(plan: Plan): StatusTask[] {
  return WORKFLOW_STEPS.map((s) => {
    const [status, planned_date] = plan[s.type] ?? ['NOT_STARTED', null]
    return { task_type: s.type, status, planned_date }
  })
}

const reports = (r: Partial<Record<StatusReport['report_type'], StatusReport['result']>> = {}): StatusReport[] =>
  (['LOAD_TEST', 'LONGEVITY', 'HIT'] as const).map((t) => ({ report_type: t, result: r[t] ?? 'NOT_REVIEWED' }))

function input(plan: Plan, opts: Partial<StatusInput['release']> = {}, r = reports()): StatusInput {
  return {
    release: { planned_deployment_date: '2026-10-13', actual_deployment_date: null, status_override: null, ...opts },
    tasks: tasks(plan),
    reports: r,
  }
}

const done = (date = '2026-10-05'): [TaskStatus, string] => ['COMPLETED', date]

describe('computeReleaseStatus', () => {
  it('ON_TRACK: seed RC_1, reports stage with nothing overdue', () => {
    const r = computeReleaseStatus(
      input(
        {
          RELEASE_IDENTIFIED: done('2026-10-04'),
          RC_CREATION: done(),
          AUTOMATED_JOBS: done('2026-10-06'),
          LOAD_TEST_REVIEW: done('2026-10-08'),
          LONGEVITY_REVIEW: ['IN_PROGRESS', '2026-10-09'],
          HIT_REVIEW: ['NOT_STARTED', '2026-10-10'],
          DEPLOYMENT: ['NOT_STARTED', '2026-10-13'],
        },
        {},
        reports({ LOAD_TEST: 'PASS' }),
      ),
      today,
    )
    expect(r).toEqual({ status: 'ON_TRACK', overridden: false, reasons: [] })
  })

  it('AT_RISK: seed RC_2, automated jobs overdue since yesterday', () => {
    const r = computeReleaseStatus(
      input({ RELEASE_IDENTIFIED: done(), RC_CREATION: done(), AUTOMATED_JOBS: ['IN_PROGRESS', '2026-10-06'] }, {
        planned_deployment_date: '2026-10-16',
      }),
      today,
    )
    expect(r.status).toBe('AT_RISK')
    expect(r.reasons).toEqual(['Automated jobs overdue since Oct 6'])
  })

  it('WAITING_FOR_APPROVAL: seed HF_1, everything before approval done or skipped', () => {
    const plan: Plan = Object.fromEntries(
      WORKFLOW_STEPS.slice(0, 9).map((s) => [s.type, done('2026-10-07')]),
    )
    plan.LOAD_TEST_REVIEW = ['SKIPPED', '2026-10-06']
    plan.APPROVAL = ['IN_PROGRESS', '2026-10-08']
    const r = computeReleaseStatus(input(plan, { planned_deployment_date: '2026-10-09' }), today)
    expect(r.status).toBe('WAITING_FOR_APPROVAL')
    // Still surfaces the deadline pressure as a reason.
    expect(r.reasons).toEqual(['Deployment in 2 days, not yet approved'])
  })

  it('BLOCKED: a blocked step wins over risks', () => {
    const r = computeReleaseStatus(
      input({ AUTOMATED_JOBS: ['BLOCKED', '2026-10-01'] }),
      today,
    )
    expect(r.status).toBe('BLOCKED')
    expect(r.reasons[0]).toBe('Automated jobs blocked')
  })

  it('BLOCKED: failed report, without duplicating the blocked review step', () => {
    const viaStep = computeReleaseStatus(
      { ...input({ HIT_REVIEW: ['BLOCKED', null] }, {}, reports({ HIT: 'FAIL' })), tasks: tasks({ HIT_REVIEW: ['BLOCKED', null] }).map((t) => (t.task_type === 'HIT_REVIEW' ? { ...t, blocker_reason: 'HIT report failed' } : t)) },
      today,
    )
    expect(viaStep.reasons).toEqual(['HIT review blocked: HIT report failed'])

    const reportOnly = computeReleaseStatus(input({}, {}, reports({ LOAD_TEST: 'FAIL' })), today)
    expect(reportOnly).toMatchObject({ status: 'BLOCKED', reasons: ['Load Test report failed'] })
  })

  it('a WARNING report does not change status', () => {
    expect(computeReleaseStatus(input({}, {}, reports({ LONGEVITY: 'WARNING' })), today).status).toBe('ON_TRACK')
  })

  it('AT_RISK when the target date has passed, even if waiting for approval', () => {
    const r = computeReleaseStatus(input({}, { planned_deployment_date: '2026-10-06' }), today)
    expect(r).toMatchObject({ status: 'AT_RISK', reasons: ['Target deployment (Oct 6) has passed'] })
  })

  it('AT_RISK when a step is planned after the target', () => {
    const r = computeReleaseStatus(input({ RTP_CREATION: ['NOT_STARTED', '2026-10-14'] }), today)
    expect(r).toMatchObject({ status: 'AT_RISK', reasons: ['RTP creation planned after target deployment'] })
  })

  it('AT_RISK when deployment is close and approval is not done', () => {
    const r = computeReleaseStatus(input({}, { planned_deployment_date: '2026-10-08' }), today)
    expect(r).toMatchObject({ status: 'AT_RISK', reasons: ['Deployment in 1 day, not yet approved'] })
  })

  it('RELEASED once deployment is completed', () => {
    expect(computeReleaseStatus(input({ DEPLOYMENT: done() }), today).status).toBe('RELEASED')
    expect(computeReleaseStatus(input({}, { actual_deployment_date: '2026-10-06' }), today).status).toBe('RELEASED')
  })

  it('manual override wins', () => {
    const r = computeReleaseStatus(
      input({ AUTOMATED_JOBS: ['BLOCKED', null] }, { status_override: 'ON_TRACK', status_override_reason: 'Known flake' }),
      today,
    )
    expect(r).toEqual({ status: 'ON_TRACK', overridden: true, reasons: ['Known flake'] })
  })
})

describe('nextAction', () => {
  it('picks the earliest-planned ready step among parallel reviews', () => {
    const t = tasks({
      RELEASE_IDENTIFIED: done(),
      RC_CREATION: done(),
      AUTOMATED_JOBS: done(),
      LOAD_TEST_REVIEW: done(),
      LONGEVITY_REVIEW: ['IN_PROGRESS', '2026-10-09'],
      HIT_REVIEW: ['NOT_STARTED', '2026-10-08'],
      RC_EMAIL: ['NOT_STARTED', '2026-10-07'], // earlier, but its prerequisites are open
    })
    expect(nextAction(t)).toEqual({ type: 'HIT_REVIEW', label: 'Review HIT report', due: '2026-10-08', blocked: false })
  })

  it('prioritises blocked steps', () => {
    const t = tasks({
      RELEASE_IDENTIFIED: done(),
      RC_CREATION: done(),
      AUTOMATED_JOBS: done(),
      LOAD_TEST_REVIEW: ['NOT_STARTED', '2026-10-08'],
      HIT_REVIEW: ['BLOCKED', '2026-10-10'],
    })
    expect(nextAction(t)).toMatchObject({ type: 'HIT_REVIEW', label: 'Unblock HIT review', blocked: true })
  })

  it('starts at the first step for a new release and returns null when all done', () => {
    expect(nextAction(tasks({}))?.type).toBe('RELEASE_IDENTIFIED')
    const all = Object.fromEntries(WORKFLOW_STEPS.map((s) => [s.type, done()])) as Plan
    expect(nextAction(tasks(all))).toBeNull()
  })
})
