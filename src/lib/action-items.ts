import type { ReleaseStatus, ReportType, TaskStatus, WorkflowTaskType } from '@/types/domain'
import { daysFromToday, formatDay } from './dates'
import { computeReleaseStatus, type StatusReport } from './release-status'
import { isDone, REPORT_LABELS, STEP_BY_TYPE } from './workflow'

/**
 * "Action required" items derived from release state.
 *
 * Pure and framework-free (only date-fns), so the same rules can run in a
 * scheduled server job (e.g. a Supabase Edge Function) to send email / Slack /
 * Teams notifications later. Item ids are stable across runs for the same
 * condition, which is what a delivery channel needs to de-duplicate.
 */

export type ActionKind =
  | 'blocked'
  | 'overdue'
  | 'due_today'
  | 'awaiting_approval'
  | 'deployment_overdue'
  | 'deployment_soon'

export type ActionSeverity = 'critical' | 'warning' | 'info'

export interface ActionItem {
  id: string
  kind: ActionKind
  severity: ActionSeverity
  releaseId: string
  releaseName: string
  title: string
  detail: string | null
  due: string | null
  /** Who should act: step owner, or release owner for release-level items. */
  assigneeId: string | null
  taskType: WorkflowTaskType | null
}

export interface ActionRelease {
  id: string
  name: string
  planned_deployment_date: string
  actual_deployment_date: string | null
  status_override: ReleaseStatus | null
  owner: { id: string } | null
  tasks: readonly {
    task_type: WorkflowTaskType
    status: TaskStatus
    planned_date: string | null
    blocker_reason: string | null
    owner_id: string | null
  }[]
  reports: readonly StatusReport[]
}

/** Deployments this close show up as an item. */
export const DEPLOYMENT_SOON_DAYS = 2

const SEVERITY_ORDER: Record<ActionSeverity, number> = { critical: 0, warning: 1, info: 2 }

const REPORT_FOR_STEP: Partial<Record<WorkflowTaskType, ReportType>> = {
  LOAD_TEST_REVIEW: 'LOAD_TEST',
  LONGEVITY_REVIEW: 'LONGEVITY',
  HIT_REVIEW: 'HIT',
}

function stepLabel(type: WorkflowTaskType): string {
  const report = REPORT_FOR_STEP[type]
  return report ? `${REPORT_LABELS[report]} report review` : STEP_BY_TYPE[type].name
}

function inDays(n: number): string {
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
}

export function releaseActionItems(release: ActionRelease, today = new Date()): ActionItem[] {
  const { status } = computeReleaseStatus(
    { release: { ...release, status_override_reason: null }, tasks: release.tasks, reports: release.reports },
    today,
  )
  if (status === 'RELEASED') return []

  const items: ActionItem[] = []
  const base = { releaseId: release.id, releaseName: release.name }

  for (const t of release.tasks) {
    if (isDone(t.status)) continue
    const label = stepLabel(t.task_type)
    const common = { ...base, assigneeId: t.owner_id, taskType: t.task_type, due: t.planned_date }

    if (t.status === 'BLOCKED') {
      items.push({
        ...common,
        id: `${release.id}:blocked:${t.task_type}`,
        kind: 'blocked',
        severity: 'critical',
        title: `${label} blocked`,
        detail: t.blocker_reason,
      })
      continue
    }
    if (!t.planned_date) continue
    const diff = daysFromToday(t.planned_date, today)
    if (diff < 0) {
      items.push({
        ...common,
        id: `${release.id}:overdue:${t.task_type}`,
        kind: 'overdue',
        severity: 'critical',
        title: `${label} overdue`,
        detail: `Was due ${formatDay(t.planned_date)}`,
      })
    } else if (diff === 0) {
      items.push({
        ...common,
        id: `${release.id}:due_today:${t.task_type}`,
        kind: 'due_today',
        severity: 'warning',
        title: `${label} due today`,
        detail: null,
      })
    }
  }

  if (status === 'WAITING_FOR_APPROVAL') {
    const approval = release.tasks.find((t) => t.task_type === 'APPROVAL')
    items.push({
      ...base,
      id: `${release.id}:awaiting_approval`,
      kind: 'awaiting_approval',
      severity: 'warning',
      title: 'Waiting for approval',
      detail: null,
      due: approval?.planned_date ?? null,
      assigneeId: approval?.owner_id ?? release.owner?.id ?? null,
      taskType: 'APPROVAL',
    })
  }

  const targetIn = daysFromToday(release.planned_deployment_date, today)
  if (targetIn < 0) {
    items.push({
      ...base,
      id: `${release.id}:deployment_overdue`,
      kind: 'deployment_overdue',
      severity: 'critical',
      title: 'Target deployment date passed',
      detail: `Was ${formatDay(release.planned_deployment_date)}`,
      due: release.planned_deployment_date,
      assigneeId: release.owner?.id ?? null,
      taskType: null,
    })
  } else if (targetIn <= DEPLOYMENT_SOON_DAYS) {
    items.push({
      ...base,
      id: `${release.id}:deployment_soon`,
      kind: 'deployment_soon',
      severity: targetIn === 0 ? 'warning' : 'info',
      title: `Target deployment ${inDays(targetIn)}`,
      detail: formatDay(release.planned_deployment_date, 'EEE, MMM d'),
      due: release.planned_deployment_date,
      assigneeId: release.owner?.id ?? null,
      taskType: null,
    })
  }

  return items
}

/** All items, most urgent first: severity, then due date, then release name. */
export function buildActionItems(releases: readonly ActionRelease[], today = new Date()): ActionItem[] {
  return releases
    .flatMap((r) => releaseActionItems(r, today))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
        a.releaseName.localeCompare(b.releaseName),
    )
}
