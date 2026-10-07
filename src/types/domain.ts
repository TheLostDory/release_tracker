import type { Database } from './database'

type Enums = Database['public']['Enums']

export type SprintStatus = Enums['sprint_status']
export type TaskStatus = Enums['task_status']
export type WorkflowTaskType = Enums['workflow_task_type']
export type ReportType = Enums['report_type']
export type ReportResult = Enums['report_result']
export type ReleaseStatus = Enums['release_status']
export type ApprovalStatus = Enums['approval_status']

export interface Sprint {
  id: string
  name: string
  start_date: string
  end_date: string
  status: SprintStatus
}

export interface SprintWithCount extends Sprint {
  release_count: number
}

export interface ProfileSummary {
  id: string
  name: string
}
