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
  testFailures: {
    enabled: boolean
    purposes: ('LOAD_TEST' | 'LONGEVITY' | 'HIT')[]
    bugTypes: string[]
    failedPattern: string
    allProjects: boolean
    /** Report location relative to the build, per run type ('' = find it). */
    reportPaths?: Record<'LOAD_TEST' | 'LONGEVITY' | 'HIT', string>
  }
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

// --- Failed tests → Jira bugs --------------------------------------------------------------

export interface FoundBug {
  key: string
  summary: string
  type: string
  status: string
  statusCategory: string
  url: string
  via: string
}

/** A failed test, and the script name / IDs it was looked up by in Jira (none: by its name). */
export interface FailedTestRef {
  name: string
  script?: string
  ids?: string[]
}

export interface TestAnalysis {
  run_id: string
  state: 'pending' | 'done' | 'failed'
  result: { reportUrl: string; runResult: string | null; failedTests: (FailedTestRef & { bugs: FoundBug[] })[]; notes: string[]; how?: string[] } | null
  error: string | null
  analyzed_at: string | null
}

export const listTestAnalyses = (releaseId: string) => api.get<TestAnalysis[]>(`/releases/${releaseId}/test-analyses`)
export const analyzeRun = ({ runId, reportUrl }: { runId: string; reportUrl?: string }) =>
  api.post(`/jenkins/followed/${runId}/analyze`, reportUrl ? { reportUrl } : {})
export const previewTestReport = (projectId: string, reportUrl: string, pattern: string) =>
  api.post<{ failedTests: FailedTestRef[]; how: string[] }>(`/projects/${projectId}/test-report/preview`, { reportUrl, pattern })
