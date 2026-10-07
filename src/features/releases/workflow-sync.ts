import { REPORT_LABELS, REVIEW_STEP_FOR_REPORT } from '@/lib/workflow'
import type { ApprovalStatus, TaskStatus } from '@/types/domain'
import type { ApprovalPatch, ReleaseDetail, ReleaseReport, ReleaseTask, ReportPatch, TaskPatch } from './api'

/*
 * Client mirror of the DB triggers in 20261009000000_workflow_sync.sql, used
 * only for optimistic updates. The refetch after each mutation replaces the
 * optimistic state with the server's.
 */

export function applyTaskPatch(task: ReleaseTask, patch: TaskPatch, now: string): ReleaseTask {
  const next = { ...task, ...patch }
  if (patch.status && patch.status !== task.status) {
    if (patch.status === 'COMPLETED' && !next.completed_at) next.completed_at = now
    if (patch.status !== 'COMPLETED' && patch.completed_at === undefined) next.completed_at = null
    if (task.status === 'BLOCKED' && patch.blocker_reason === undefined) next.blocker_reason = null
  }
  return next
}

export function reviewTaskStatus(report: Pick<ReleaseReport, 'status' | 'result'>): TaskStatus {
  if (report.status === 'SKIPPED') return 'SKIPPED'
  if (report.result === 'FAIL') return 'BLOCKED'
  if (report.result === 'PASS' || report.result === 'WARNING') return 'COMPLETED'
  return report.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'NOT_STARTED'
}

export function approvalTaskStatus(status: ApprovalStatus): TaskStatus {
  return status === 'APPROVED' ? 'COMPLETED' : status === 'REJECTED' ? 'BLOCKED' : 'IN_PROGRESS'
}

export function applyReportPatch(release: ReleaseDetail, reportId: string, patch: ReportPatch, now: string): ReleaseDetail {
  const report = release.reports.find((r) => r.id === reportId)
  if (!report) return release
  const next: ReleaseReport = { ...report, ...patch }
  if (patch.result && patch.result !== report.result) {
    if (patch.result === 'NOT_REVIEWED') {
      if (next.status === 'COMPLETED') next.status = 'IN_PROGRESS'
      next.reviewed_at = null
    } else {
      next.status = 'COMPLETED'
      next.reviewed_at = now
    }
  }
  const stepType = REVIEW_STEP_FOR_REPORT[report.report_type]
  const taskStatus = reviewTaskStatus(next)
  return {
    ...release,
    reports: release.reports.map((r) => (r.id === reportId ? next : r)),
    tasks: release.tasks.map((t) =>
      t.task_type === stepType && t.status !== taskStatus
        ? {
            ...t,
            status: taskStatus,
            completed_at: taskStatus === 'COMPLETED' ? next.reviewed_at : null,
            blocker_reason: taskStatus === 'BLOCKED' ? `${REPORT_LABELS[report.report_type]} report failed` : null,
          }
        : t,
    ),
  }
}

export function applyApprovalPatch(release: ReleaseDetail, patch: ApprovalPatch, now: string): ReleaseDetail {
  if (!release.approval) return release
  const approval = { ...release.approval, ...patch }
  if (patch.status && patch.status !== release.approval.status) {
    approval.approved_at = patch.status === 'PENDING' ? null : now
    const taskStatus = approvalTaskStatus(patch.status)
    return {
      ...release,
      approval,
      tasks: release.tasks.map((t) =>
        t.task_type === 'APPROVAL'
          ? {
              ...t,
              status: taskStatus,
              completed_at: taskStatus === 'COMPLETED' ? now : null,
              blocker_reason: taskStatus === 'BLOCKED' ? 'Approval rejected' : null,
            }
          : t,
      ),
    }
  }
  return { ...release, approval }
}
