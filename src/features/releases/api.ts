import { supabase } from '@/lib/supabase'
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
  sprint_id: string
  name: string
  version: string
  owner_id: string | null
  planned_deployment_date: string
  description: string | null
}

export interface ReleasePatch extends Partial<ReleaseInput> {
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
  sprint: { id: string; name: string }
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
  sprint: { id: string; name: string; start_date: string; end_date: string }
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
  sprintId?: string
  /** Only releases not yet deployed (any sprint). */
  open?: boolean
  /** Target deployment within [from, to] (calendar days). */
  deploymentFrom?: string
  deploymentTo?: string
}

/** Hard cap for the unfiltered list; the UI says when it is reached. */
export const RELEASE_LIST_LIMIT = 500

const LIST_COLUMNS = `
  id, name, version, planned_deployment_date, actual_deployment_date, status_override, status_override_reason,
  sprint:sprints!inner(id, name),
  owner:profiles!releases_owner_id_fkey(id, name),
  tasks:release_tasks(task_type, status, planned_date, completed_at, blocker_reason, owner_id),
  reports(report_type, result)
`

/** Releases with their steps/reports in one round trip (no N+1). */
export async function listReleases({
  sprintId,
  open,
  deploymentFrom,
  deploymentTo,
}: ReleaseFilters = {}): Promise<ReleaseListItem[]> {
  let query = supabase
    .from('releases')
    .select(LIST_COLUMNS)
    // One sprint: chronological. All sprints: most recent targets first.
    .order('planned_deployment_date', { ascending: !!sprintId })
    .limit(RELEASE_LIST_LIMIT)
  if (sprintId) query = query.eq('sprint_id', sprintId)
  if (open) query = query.is('actual_deployment_date', null)
  if (deploymentFrom) query = query.gte('planned_deployment_date', deploymentFrom)
  if (deploymentTo) query = query.lte('planned_deployment_date', deploymentTo)

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getRelease(id: string): Promise<ReleaseDetail> {
  const { data, error } = await supabase
    .from('releases')
    .select(
      `id, name, version, description, planned_deployment_date, actual_deployment_date,
       status_override, status_override_reason, created_at,
       sprint:sprints!inner(id, name, start_date, end_date),
       owner:profiles!releases_owner_id_fkey(id, name),
       tasks:release_tasks(id, task_type, name, position, status, planned_date, completed_at,
         owner_id, notes, link, blocker_reason),
       reports(id, report_type, status, result, report_url, reviewed_at, notes,
         reviewer:profiles!reports_reviewer_id_fkey(id, name)),
       approvals(id, status, requested_at, approved_at, comments,
         approver:profiles!approvals_approved_by_fkey(id, name))`,
    )
    .eq('id', id)
    .order('position', { referencedTable: 'release_tasks' })
    .order('report_type', { referencedTable: 'reports' })
    .single()
  if (error) throw error
  const { approvals, ...release } = data
  return { ...release, approval: approvals ?? null }
}

export async function listActivity(releaseId: string): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, action, description, created_at, user:profiles!activity_log_user_id_fkey(id, name)')
    .eq('release_id', releaseId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data
}

export async function createRelease(input: ReleaseInput): Promise<{ id: string }> {
  const { data, error } = await supabase.from('releases').insert(input).select('id').single()
  if (error) throw error
  return data
}

export async function updateRelease(id: string, patch: ReleasePatch): Promise<void> {
  const { error } = await supabase.from('releases').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteRelease(id: string): Promise<void> {
  const { error } = await supabase.from('releases').delete().eq('id', id)
  if (error) throw error
}

export async function updateTask(id: string, patch: TaskPatch): Promise<void> {
  const { error } = await supabase.from('release_tasks').update(patch).eq('id', id)
  if (error) throw error
}

export async function updateReport(id: string, patch: ReportPatch): Promise<void> {
  const { error } = await supabase.from('reports').update(patch).eq('id', id)
  if (error) throw error
}

export async function updateApproval(id: string, patch: ApprovalPatch): Promise<void> {
  const { error } = await supabase.from('approvals').update(patch).eq('id', id)
  if (error) throw error
}
