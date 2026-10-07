import { computeReleaseStatus, nextAction, type NextAction, type StatusResult } from '@/lib/release-status'
import { isDone } from '@/lib/workflow'
import type { ListReport, ListTask, ReleaseListItem } from './api'

export interface ReleaseSummary {
  status: StatusResult
  next: NextAction | null
  done: number
  total: number
}

type Summarizable = Pick<
  ReleaseListItem,
  'planned_deployment_date' | 'actual_deployment_date' | 'status_override' | 'status_override_reason'
> & { tasks: readonly ListTask[]; reports: readonly ListReport[] }

export function summarizeRelease(release: Summarizable, today = new Date()): ReleaseSummary {
  return {
    status: computeReleaseStatus({ release, tasks: release.tasks, reports: release.reports }, today),
    next: release.actual_deployment_date ? null : nextAction(release.tasks),
    done: release.tasks.filter((t) => isDone(t.status)).length,
    total: release.tasks.length,
  }
}
