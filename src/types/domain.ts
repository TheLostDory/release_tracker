/** Domain enums (mirror the Postgres enums in server/db/migrations). */
export type SprintStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED'
export type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED' | 'SKIPPED'
export type WorkflowTaskType =
  | 'RELEASE_IDENTIFIED'
  | 'RC_CREATION'
  | 'AUTOMATED_JOBS'
  | 'LOAD_TEST_REVIEW'
  | 'LONGEVITY_REVIEW'
  | 'HIT_REVIEW'
  | 'RC_EMAIL'
  | 'RTP_CREATION'
  | 'RC_ESCALATION_EMAIL'
  | 'APPROVAL'
  | 'RELEASE_EMAIL'
  | 'DEPLOYMENT'
export type ReportType = 'LOAD_TEST' | 'LONGEVITY' | 'HIT'
export type ReportResult = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_REVIEWED'
export type ReleaseStatus = 'ON_TRACK' | 'AT_RISK' | 'BLOCKED' | 'WAITING_FOR_APPROVAL' | 'RELEASED'
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type ProjectRole = 'VIEWER' | 'MEMBER' | 'ADMIN' | 'OWNER'

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

export interface User {
  id: string
  email: string
  name: string
  avatar_url: string | null
}
