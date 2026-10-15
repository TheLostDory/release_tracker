import { api, qs } from '@/lib/api'
import type {
  ApprovalStatus,
  ProfileSummary,
  ReleaseStatus,
  ReportResult,
  ReportType,
  TaskStatus,
  WorkflowTaskType,
} from '@/types/domain'

export interface ReleaseInput {
  project_id: string
  /** Optional: projects can work without sprints. */
  sprint_id: string | null
  name: string
  version: string
  owner_id: string | null
  planned_deployment_date: string
  description: string | null
}

export interface ReleasePatch extends Partial<Omit<ReleaseInput, 'project_id'>> {
  actual_deployment_date?: string | null
  status_override?: ReleaseStatus | null
  status_override_reason?: string | null
}

/** Minimal step/report shape: enough to compute status, progress and next action. */
export interface ListTask {
  task_type: WorkflowTaskType
  owner_id: string | null
  completed_at: string | null
  status: TaskStatus
  planned_date: string | null
  blocker_reason: string | null
}

export interface ListReport {
  report_type: ReportType
  result: ReportResult
}

export interface ReleaseListItem {
  id: string
  name: string
  version: string
  planned_deployment_date: string
  actual_deployment_date: string | null
  status_override: ReleaseStatus | null
  status_override_reason: string | null
  project: { id: string; name: string }
  sprint: { id: string; name: string } | null
  owner: ProfileSummary | null
  tasks: ListTask[]
  reports: ListReport[]
}

export interface ReleaseTask {
  id: string
  task_type: WorkflowTaskType
  name: string
  position: number
  status: TaskStatus
  planned_date: string | null
  completed_at: string | null
  owner_id: string | null
  notes: string | null
  link: string | null
  blocker_reason: string | null
}

export interface ReleaseReport {
  id: string
  report_type: ReportType
  status: TaskStatus
  result: ReportResult
  report_url: string | null
  reviewed_at: string | null
  notes: string | null
  reviewer: ProfileSummary | null
}

export interface ReleaseApproval {
  id: string
  status: ApprovalStatus
  requested_at: string | null
  approved_at: string | null
  comments: string | null
  approver: ProfileSummary | null
}

export interface ReleaseDetail {
  id: string
  name: string
  version: string
  description: string | null
  planned_deployment_date: string
  actual_deployment_date: string | null
  status_override: ReleaseStatus | null
  status_override_reason: string | null
  created_at: string
  project_id: string
  sprint: { id: string; name: string; start_date: string; end_date: string } | null
  owner: ProfileSummary | null
  tasks: ReleaseTask[]
  reports: ReleaseReport[]
  approval: ReleaseApproval | null
}

export interface ActivityEntry {
  id: string
  action: string
  description: string
  created_at: string
  user: ProfileSummary | null
}

export type TaskPatch = Partial<
  Pick<ReleaseTask, 'status' | 'planned_date' | 'completed_at' | 'owner_id' | 'notes' | 'link' | 'blocker_reason'>
>
export type ReportPatch = Partial<Pick<ReleaseReport, 'status' | 'result' | 'report_url' | 'notes'>>
export type ApprovalPatch = Partial<Pick<ReleaseApproval, 'status' | 'comments'>>

export interface ReleaseFilters {
  projectId?: string
  /** A sprint id, or 'none' for releases without a sprint. */
  sprintId?: string
  /** Only releases not yet deployed (any sprint). */
  open?: boolean
  /** Target deployment within [from, to] (calendar days). */
  deploymentFrom?: string
  deploymentTo?: string
}

/** Hard cap for one list (server side); the UI says when it is reached. */
export const RELEASE_LIST_LIMIT = 500

/** Releases with their steps/reports in one round trip. */
export function listReleases({ projectId, sprintId, open, deploymentFrom, deploymentTo }: ReleaseFilters = {}): Promise<ReleaseListItem[]> {
  return api.get<ReleaseListItem[]>(
    `/releases${qs({ projectId, sprintId, open: open ? 'true' : undefined, deploymentFrom, deploymentTo })}`,
  )
}

export function getRelease(id: string): Promise<ReleaseDetail> {
  return api.get<ReleaseDetail>(`/releases/${id}`)
}

export function listActivity(releaseId: string): Promise<ActivityEntry[]> {
  return api.get<ActivityEntry[]>(`/releases/${releaseId}/activity`)
}

export function createRelease(input: ReleaseInput): Promise<{ id: string }> {
  return api.post<{ id: string }>('/releases', input)
}

export function updateRelease(id: string, patch: ReleasePatch): Promise<void> {
  return api.patch(`/releases/${id}`, patch)
}

export function deleteRelease(id: string): Promise<void> {
  return api.del(`/releases/${id}`)
}

export function updateTask(id: string, patch: TaskPatch): Promise<void> {
  return api.patch(`/tasks/${id}`, patch)
}

export function updateReport(id: string, patch: ReportPatch): Promise<void> {
  return api.patch(`/reports/${id}`, patch)
}

export function updateApproval(id: string, patch: ApprovalPatch): Promise<void> {
  return api.patch(`/approvals/${id}`, patch)
}
