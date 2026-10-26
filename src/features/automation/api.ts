import { api } from '@/lib/api'
import type { WorkflowTaskType } from '@/types/domain'

export type EmailStep = 'RC_EMAIL' | 'RC_ESCALATION_EMAIL' | 'RELEASE_EMAIL'
export type JobPurpose = 'LOAD_TEST' | 'LONGEVITY' | 'HIT' | 'AUTOMATED'

/** Per-project automation (server: server/automation/settings.ts). */
export interface AutomationSettings {
  planDates: { enabled: boolean; offsets: Partial<Record<WorkflowTaskType, number>> }
  emails: { recipients: Record<EmailStep, { to: string; cc: string }> }
  jenkins: { autoStart: boolean; jobs: { purpose: JobPurpose; jobPath: string; parameters: Record<string, string> }[] }
  autoComplete: { rcCreationFromGithub: boolean; deploymentFromJira: boolean }
  jiraSync: { importVersions: boolean; syncDates: boolean }
  codeCheck: { background: boolean }
}

export const getAutomation = (projectId: string) => api.get<AutomationSettings>(`/projects/${projectId}/automation`)
export const saveAutomation = (projectId: string, settings: AutomationSettings) => api.put(`/projects/${projectId}/automation`, settings)
export const planReleaseDates = (releaseId: string) => api.post<{ changed: number }>(`/releases/${releaseId}/plan-dates`)
