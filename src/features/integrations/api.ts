import { api, qs } from '@/lib/api'

export type IntegrationKind = 'JIRA' | 'JENKINS'
export type IntegrationAuth = 'JIRA_CLOUD' | 'JIRA_SERVER' | 'JENKINS'

/** A project's connection. Credentials never come back from the server. */
export interface Integration {
  id: string
  kind: IntegrationKind
  auth_type: IntegrationAuth
  base_url: string
  username: string | null
  settings: { projectKey?: string }
  last_error: string | null
  last_checked_at: string | null
}

export interface SaveIntegrationInput {
  authType: IntegrationAuth
  baseUrl: string
  username?: string | null
  /** Omit to keep the stored token. */
  secret?: string
  projectKey?: string
}

export interface JiraVersion {
  id: string
  name: string
  released: boolean
  archived: boolean
  releaseDate: string | null
  description: string | null
  /** The release already linked to this version, if any. */
  release: { id: string; name: string } | null
}

export interface JiraIssue {
  key: string
  summary: string
  type: string
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown'
  priority: string | null
  assignee: string | null
  url: string
}

export type JiraIssuesResponse =
  | { linked: false }
  | { linked: true; versionUrl: string; issues: JiraIssue[]; truncated: boolean }

export type JenkinsPurpose = 'AUTOMATED' | 'LOAD_TEST' | 'LONGEVITY' | 'HIT' | 'OTHER'

export interface JenkinsBuild {
  number: number
  result: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'ABORTED' | 'NOT_BUILT' | null
  building: boolean
  url: string
  timestamp: number
  duration: number
  reportUrl: string | null
}

export interface JenkinsJob {
  id: string
  job_path: string
  purpose: JenkinsPurpose
  parameters: Record<string, string>
  last_build: JenkinsBuild | null
  last_synced_at: string | null
  last_error: string | null
}

const kindPath = (kind: IntegrationKind) => kind.toLowerCase()

export const listIntegrations = (projectId: string) => api.get<Integration[]>(`/projects/${projectId}/integrations`)
export const saveIntegration = (projectId: string, kind: IntegrationKind, input: SaveIntegrationInput) =>
  api.put<{ message: string }>(`/projects/${projectId}/integrations/${kindPath(kind)}`, input)
export const testIntegration = (projectId: string, kind: IntegrationKind) =>
  api.post<{ message: string }>(`/projects/${projectId}/integrations/${kindPath(kind)}/test`)
export const deleteIntegration = (projectId: string, kind: IntegrationKind) =>
  api.del(`/projects/${projectId}/integrations/${kindPath(kind)}`)

export const listJiraVersions = (projectId: string) => api.get<JiraVersion[]>(`/projects/${projectId}/jira/versions`)
export const importJiraVersions = (projectId: string, versionIds: string[], sprintId: string | null) =>
  api.post<{ created: string[] }>(`/projects/${projectId}/jira/import`, { versionIds, sprintId })
export const linkJiraVersion = (releaseId: string, versionId: string | null) => api.put(`/releases/${releaseId}/jira`, { versionId })
export const getJiraIssues = (releaseId: string, refresh = false) =>
  api.get<JiraIssuesResponse>(`/releases/${releaseId}/jira/issues${qs({ refresh: refresh || undefined })}`)

export const listJenkinsJobs = (releaseId: string) => api.get<JenkinsJob[]>(`/releases/${releaseId}/jenkins`)
export const linkJenkinsJob = (releaseId: string, input: { jobPath: string; purpose: JenkinsPurpose; parameters: Record<string, string> }) =>
  api.post<{ id: string }>(`/releases/${releaseId}/jenkins`, input)
export const unlinkJenkinsJob = (jobId: string) => api.del(`/jenkins/jobs/${jobId}`)
export const runJenkinsJob = (jobId: string) => api.post(`/jenkins/jobs/${jobId}/run`)
export const syncJenkins = (releaseId: string) => api.post<{ synced: number; failed: number }>(`/releases/${releaseId}/jenkins/sync`)
export const listJenkinsBuilds = (jobId: string) => api.get<JenkinsBuild[]>(`/jenkins/jobs/${jobId}/builds`)
