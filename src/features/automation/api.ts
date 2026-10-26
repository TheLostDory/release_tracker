import { api } from '@/lib/api'
import type { WorkflowTaskType } from '@/types/domain'

export type EmailStep = 'RC_EMAIL' | 'RC_ESCALATION_EMAIL' | 'RELEASE_EMAIL'
export type JobPurpose = 'LOAD_TEST' | 'LONGEVITY' | 'HIT' | 'AUTOMATED'

/** Per-project automation (server: server/automation/settings.ts). */
export interface AutomationSettings {
  planDates: { enabled: boolean; offsets: Partial<Record<WorkflowTaskType, number>> }
  emails: { recipients: Record<EmailStep, { to: string; cc: string }> }
  jenkins: {
    autoStart: boolean
    /** startedByParent: another job (a parent) starts it; its runs still fill the slot. */
    jobs: { purpose: JobPurpose; jobPath: string; parameters: Record<string, string>; startedByParent?: boolean }[]
  }
  autoComplete: { rcCreationFromGithub: boolean; deploymentFromJira: boolean }
  jiraSync: { importVersions: boolean; syncDates: boolean }
  codeCheck: { background: boolean }
}

export const getAutomation = (projectId: string) => api.get<AutomationSettings>(`/projects/${projectId}/automation`)
export const saveAutomation = (projectId: string, settings: AutomationSettings) => api.put(`/projects/${projectId}/automation`, settings)
export const planReleaseDates = (releaseId: string) => api.post<{ changed: number }>(`/releases/${releaseId}/plan-dates`)

export interface EmailDraft {
  step: EmailStep
  to: string
  cc: string
  subject: string
  text: string
  html: string
  /** E.g. Jira couldn't be read, so the content list is missing. */
  notes: string[]
}

export const getEmailDraft = (releaseId: string, step: EmailStep) => api.get<EmailDraft>(`/releases/${releaseId}/emails/${step}`)

/** A requested start of an automated Jenkins job, until it becomes a run. */
export interface JenkinsStart {
  id: string
  purpose: JobPurpose
  job_path: string
  parameters: Record<string, string>
  state: 'to_start' | 'queued' | 'failed'
  last_error: string | null
  created_at: string
}

export const listJenkinsStarts = (releaseId: string) => api.get<JenkinsStart[]>(`/releases/${releaseId}/jenkins/starts`)
export const startJenkinsJobs = (releaseId: string) =>
  api.post<{ queued: number; started: number; resolved: number; failed: number }>(`/releases/${releaseId}/jenkins/start`)
export const dismissJenkinsStart = (id: string) => api.del(`/jenkins/starts/${id}`)
