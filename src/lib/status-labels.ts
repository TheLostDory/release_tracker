import type { ReleaseStatus, ReportResult, SprintStatus, TaskStatus } from '@/types/domain'

export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
}

export const SPRINT_STATUS_OPTIONS = (Object.keys(SPRINT_STATUS_LABELS) as SprintStatus[]).map((value) => ({
  value,
  label: SPRINT_STATUS_LABELS[value],
}))

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  BLOCKED: 'Blocked',
  WAITING_FOR_APPROVAL: 'Waiting for approval',
  RELEASED: 'Released',
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  BLOCKED: 'Blocked',
  SKIPPED: 'Skipped',
}

export const REPORT_RESULT_LABELS: Record<ReportResult, string> = {
  PASS: 'Pass',
  WARNING: 'Warning',
  FAIL: 'Fail',
  NOT_REVIEWED: 'Not reviewed',
}
