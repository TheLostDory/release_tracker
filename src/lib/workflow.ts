import type { ReportType, TaskStatus, WorkflowTaskType } from '@/types/domain'

/**
 * The release workflow definition. Order and names must stay in sync with
 * public.initialize_release_workflow() in the initial migration.
 *
 * `dependsOn` encodes soft prerequisites: the UI warns when they are bypassed
 * but does not prevent it.
 */
export interface WorkflowStep {
  type: WorkflowTaskType
  name: string
  /** Imperative phrasing for "Next action". */
  action: string
  /** Compact label for timeline/calendar chips. */
  short: string
  /** Steps sharing a stage are shown as one node in the timeline. */
  stage: string
  dependsOn: readonly WorkflowTaskType[]
  /** Status is driven by a report / the approval record, not edited directly. */
  managedBy?: 'report' | 'approval'
}

const REPORT_REVIEWS = ['LOAD_TEST_REVIEW', 'LONGEVITY_REVIEW', 'HIT_REVIEW'] as const

export const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  { type: 'RELEASE_IDENTIFIED', name: 'Release identified', short: 'Identified', action: 'Confirm release scope', stage: 'Identified', dependsOn: [] },
  { type: 'RC_CREATION', name: 'RC creation', short: 'RC created', action: 'Create RC', stage: 'RC created', dependsOn: ['RELEASE_IDENTIFIED'] },
  { type: 'AUTOMATED_JOBS', name: 'Automated jobs', short: 'Auto jobs', action: 'Complete automated jobs', stage: 'Automated jobs', dependsOn: ['RC_CREATION'] },
  { type: 'LOAD_TEST_REVIEW', name: 'Load Test review', short: 'Load Test', action: 'Review Load Test report', stage: 'Reports', dependsOn: ['AUTOMATED_JOBS'], managedBy: 'report' },
  { type: 'LONGEVITY_REVIEW', name: 'Longevity review', short: 'Longevity', action: 'Review Longevity report', stage: 'Reports', dependsOn: ['AUTOMATED_JOBS'], managedBy: 'report' },
  { type: 'HIT_REVIEW', name: 'HIT review', short: 'HIT', action: 'Review HIT report', stage: 'Reports', dependsOn: ['AUTOMATED_JOBS'], managedBy: 'report' },
  { type: 'RC_EMAIL', name: 'RC email', short: 'RC email', action: 'Send RC email', stage: 'RC email', dependsOn: REPORT_REVIEWS },
  { type: 'RTP_CREATION', name: 'RTP creation', short: 'RTP', action: 'Create RTP', stage: 'RTP', dependsOn: ['RC_EMAIL', ...REPORT_REVIEWS] },
  { type: 'RC_ESCALATION_EMAIL', name: 'RC escalation email', short: 'Escalation', action: 'Send RC escalation email', stage: 'Escalation', dependsOn: ['RTP_CREATION'] },
  { type: 'APPROVAL', name: 'Approval', short: 'Approval', action: 'Get release approval', stage: 'Approval', dependsOn: ['RC_ESCALATION_EMAIL'], managedBy: 'approval' },
  { type: 'RELEASE_EMAIL', name: 'Release email', short: 'Release email', action: 'Send release email', stage: 'Release email', dependsOn: ['APPROVAL'] },
  { type: 'DEPLOYMENT', name: 'Deployment', short: 'Deploy', action: 'Deploy', stage: 'Deployment', dependsOn: ['APPROVAL', 'RELEASE_EMAIL'] },
]

export const STEP_BY_TYPE = Object.fromEntries(WORKFLOW_STEPS.map((s) => [s.type, s])) as Record<
  WorkflowTaskType,
  WorkflowStep
>

/** Timeline stages in order (reviews collapse into "Reports"). */
export const WORKFLOW_STAGES: readonly string[] = [...new Set(WORKFLOW_STEPS.map((s) => s.stage))]

export const REPORT_TYPES: readonly ReportType[] = ['LOAD_TEST', 'LONGEVITY', 'HIT']

export const REPORT_LABELS: Record<ReportType, string> = {
  LOAD_TEST: 'Load Test',
  LONGEVITY: 'Longevity',
  HIT: 'HIT',
}

export const REVIEW_STEP_FOR_REPORT: Record<ReportType, WorkflowTaskType> = {
  LOAD_TEST: 'LOAD_TEST_REVIEW',
  LONGEVITY: 'LONGEVITY_REVIEW',
  HIT: 'HIT_REVIEW',
}

export function isDone(status: TaskStatus): boolean {
  return status === 'COMPLETED' || status === 'SKIPPED'
}

/**
 * Prerequisites of `type` that are not completed or skipped. Steps the
 * release doesn't have (turned off in its project) don't block anything.
 */
export function unmetDependencies(
  type: WorkflowTaskType,
  tasks: readonly { task_type: WorkflowTaskType; status: TaskStatus }[],
): WorkflowStep[] {
  const statusByType = new Map(tasks.map((t) => [t.task_type, t.status]))
  return STEP_BY_TYPE[type].dependsOn
    .filter((dep) => {
      const status = statusByType.get(dep)
      return status !== undefined && !isDone(status)
    })
    .map((dep) => STEP_BY_TYPE[dep])
}

/** Steps that every project must keep (status and lifecycle depend on them). */
export const REQUIRED_STEPS: readonly WorkflowTaskType[] = ['RELEASE_IDENTIFIED', 'DEPLOYMENT']
