import type { ReleaseStatus, ReportResult, ReportType, TaskStatus, WorkflowTaskType } from '@/types/domain'
import { daysFromToday, formatDay } from './dates'
import { isDone, REPORT_LABELS, REVIEW_STEP_FOR_REPORT, STEP_BY_TYPE, unmetDependencies, WORKFLOW_STEPS } from './workflow'

/**
 * Overall release status and "next action", derived from the workflow.
 * Pure functions: no I/O, `today` injectable. Change the rules here only.
 *
 * Precedence:
 *   1. manual override
 *   2. RELEASED              deployment step completed
 *   3. BLOCKED               any step blocked, or any report failed
 *   4. AT_RISK               target deployment date has passed
 *   5. WAITING_FOR_APPROVAL  every step before Approval is done
 *   6. AT_RISK               overdue step / step planned after target /
 *                            target within APPROVAL_LEAD_DAYS and not approved
 *   7. ON_TRACK
 */

/** Deployment this close without approval puts the release at risk. */
export const APPROVAL_LEAD_DAYS = 2

export interface StatusTask {
  task_type: WorkflowTaskType
  status: TaskStatus
  planned_date: string | null
  blocker_reason?: string | null
}

export interface StatusReport {
  report_type: ReportType
  result: ReportResult
}

export interface StatusRelease {
  planned_deployment_date: string
  actual_deployment_date: string | null
  status_override: ReleaseStatus | null
  status_override_reason?: string | null
}

export interface StatusInput {
  release: StatusRelease
  tasks: readonly StatusTask[]
  reports: readonly StatusReport[]
}

export interface StatusResult {
  status: ReleaseStatus
  overridden: boolean
  /** Human-readable explanations, most important first. */
  reasons: string[]
}

export function computeReleaseStatus({ release, tasks, reports }: StatusInput, today = new Date()): StatusResult {
  if (release.status_override) {
    return {
      status: release.status_override,
      overridden: true,
      reasons: [release.status_override_reason?.trim() || 'Status set manually'],
    }
  }

  const byType = new Map(tasks.map((t) => [t.task_type, t]))
  const result = (status: ReleaseStatus, reasons: string[]): StatusResult => ({ status, overridden: false, reasons })

  if (release.actual_deployment_date || byType.get('DEPLOYMENT')?.status === 'COMPLETED') {
    return result('RELEASED', [])
  }

  const blockers = [
    ...tasks
      .filter((t) => t.status === 'BLOCKED')
      .map((t) => `${STEP_BY_TYPE[t.task_type].name} blocked${t.blocker_reason ? `: ${t.blocker_reason}` : ''}`),
    ...reports
      .filter((r) => r.result === 'FAIL' && byType.get(REVIEW_STEP_FOR_REPORT[r.report_type])?.status !== 'BLOCKED')
      .map((r) => `${REPORT_LABELS[r.report_type]} report failed`),
  ]
  if (blockers.length > 0) return result('BLOCKED', blockers)

  const targetIn = daysFromToday(release.planned_deployment_date, today)
  if (targetIn < 0) {
    return result('AT_RISK', [`Target deployment (${formatDay(release.planned_deployment_date)}) has passed`])
  }

  const risks: string[] = []
  for (const t of tasks) {
    if (isDone(t.status) || !t.planned_date) continue
    const name = STEP_BY_TYPE[t.task_type].name
    if (daysFromToday(t.planned_date, today) < 0) risks.push(`${name} overdue since ${formatDay(t.planned_date)}`)
    else if (t.planned_date > release.planned_deployment_date) risks.push(`${name} planned after target deployment`)
  }
  const approval = byType.get('APPROVAL')
  if (targetIn <= APPROVAL_LEAD_DAYS && approval && !isDone(approval.status)) {
    risks.push(`Deployment ${targetIn === 0 ? 'today' : `in ${targetIn} day${targetIn === 1 ? '' : 's'}`}, not yet approved`)
  }

  // Only steps this release actually has (projects can turn steps off).
  const beforeApproval = WORKFLOW_STEPS.slice(0, WORKFLOW_STEPS.findIndex((s) => s.type === 'APPROVAL'))
  const readyForApproval =
    approval !== undefined &&
    !isDone(approval.status) &&
    beforeApproval.every((s) => {
      const t = byType.get(s.type)
      return t === undefined || isDone(t.status)
    })
  if (readyForApproval) return result('WAITING_FOR_APPROVAL', risks)

  return risks.length > 0 ? result('AT_RISK', risks) : result('ON_TRACK', [])
}

export interface NextAction {
  type: WorkflowTaskType
  label: string
  due: string | null
  blocked: boolean
}

/**
 * The step to work on next: among open steps whose prerequisites are done,
 * blocked steps first, then the earliest planned date, then workflow order.
 */
export function nextAction(tasks: readonly StatusTask[]): NextAction | null {
  const position = (type: WorkflowTaskType) => WORKFLOW_STEPS.findIndex((s) => s.type === type)
  const ready = tasks
    .filter((t) => !isDone(t.status) && unmetDependencies(t.task_type, tasks).length === 0)
    .sort(
      (a, b) =>
        Number(b.status === 'BLOCKED') - Number(a.status === 'BLOCKED') ||
        (a.planned_date ?? '9999').localeCompare(b.planned_date ?? '9999') ||
        position(a.task_type) - position(b.task_type),
    )
  const t = ready[0]
  if (!t) return null
  const step = STEP_BY_TYPE[t.task_type]
  return {
    type: t.task_type,
    label: t.status === 'BLOCKED' ? `Unblock ${step.name}` : step.action,
    due: t.planned_date,
    blocked: t.status === 'BLOCKED',
  }
}

