import { api, qs } from '@/lib/api'

export type IntegrationKind = 'JIRA' | 'JENKINS' | 'GITHUB'
export type IntegrationAuth = 'JIRA_CLOUD' | 'JIRA_SERVER' | 'JENKINS' | 'GITHUB'

/** A project's connection. Credentials never come back from the server. */
export interface Integration {
  id: string
  kind: IntegrationKind
  auth_type: IntegrationAuth
  base_url: string
  username: string | null
  settings: { projectKey?: string; repos?: string[]; headTemplate?: string }
  last_error: string | null
  last_checked_at: string | null
  /** Company CA certificate(s) trusted for this connection (public, PEM). */
  ca_cert: string | null
}

export interface SaveIntegrationInput {
  authType: IntegrationAuth
  baseUrl: string
  username?: string | null
  /** Omit to keep the stored token. */
  secret?: string
  projectKey?: string
  /** GitHub: repositories (owner/name) and the RC branch pattern. */
  repos?: string[]
  headTemplate?: string
  /** Omit to keep; "" removes. */
  caCert?: string
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
export interface PresentedCertificate {
  subject: string
  issuer: string
  validTo: string
  fingerprint256: string
  selfSigned: boolean
  pem: string
}

/** Reads (doesn't trust) the certificate chain a server presents. Admins only. */
export const inspectCertificate = (projectId: string, baseUrl: string) =>
  api.post<{ host: string; certificates: PresentedCertificate[]; recommended: number }>(
    `/projects/${projectId}/integrations/inspect-certificate`,
    { baseUrl },
  )

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

/** A followed build and, nested, the builds it started (as Jenkins reports them). */
export interface BuildNode {
  jobPath: string
  /** Null while waiting in Jenkins' queue. */
  number: number | null
  name: string
  url: string
  result: JenkinsBuild['result']
  building: boolean
  queued: boolean
  timestamp: number | null
  duration: number | null
  estimatedDuration: number | null
  /** First HTML artifact (test report), when Jenkins has one. */
  reportUrl?: string | null
  children: BuildNode[]
  error?: string
}

export interface FollowedBuild {
  id: string
  release_id: string
  job_path: string
  build_number: number
  label: string | null
  /** Set when added to the Automated jobs step. */
  purpose: RunPurpose | null
  status: BuildNode | null
  last_synced_at: string | null
  last_error: string | null
  created_at: string
}

/** What a run added to the Automated jobs step is for. */
export type RunPurpose = 'AUTOMATED' | 'LOAD_TEST' | 'LONGEVITY' | 'HIT'

export const listFollowedBuilds = (releaseId: string) => api.get<FollowedBuild[]>(`/releases/${releaseId}/jenkins/followed`)
export const followBuild = (releaseId: string, input: { url: string; label?: string | null; purpose?: RunPurpose | null }) =>
  api.post<FollowedBuild>(`/releases/${releaseId}/jenkins/followed`, input)
export const refreshFollowedBuild = (id: string) => api.post<FollowedBuild>(`/jenkins/followed/${id}/refresh`)
export const unfollowBuild = (id: string) => api.del(`/jenkins/followed/${id}`)

export const listJenkinsJobs = (releaseId: string) => api.get<JenkinsJob[]>(`/releases/${releaseId}/jenkins`)
export const linkJenkinsJob = (releaseId: string, input: { jobPath: string; purpose: JenkinsPurpose; parameters: Record<string, string> }) =>
  api.post<{ id: string }>(`/releases/${releaseId}/jenkins`, input)
export const unlinkJenkinsJob = (jobId: string) => api.del(`/jenkins/jobs/${jobId}`)
export const runJenkinsJob = (jobId: string) => api.post(`/jenkins/jobs/${jobId}/run`)
export const syncJenkins = (releaseId: string) => api.post<{ synced: number; failed: number }>(`/releases/${releaseId}/jenkins/sync`)
export const listJenkinsBuilds = (jobId: string) => api.get<JenkinsBuild[]>(`/jenkins/jobs/${jobId}/builds`)

// --- RC vs Jira comparison ---------------------------------------------------------------

export interface CodeRef {
  repo: string
  base_ref: string
  head_ref: string
}

export type CodeRefs =
  | { connected: false }
  | {
      connected: true
      repos: string[]
      webUrl: string
      refs: CodeRef[]
      suggestions: { repo: string; baseRef: string; headRef: string }[]
      previousRelease: { id: string; name: string; version: string } | null
    }

export interface CodeChange {
  repo: string
  kind: 'pr' | 'merge' | 'commit'
  ref: string
  title: string
  branch: string | null
  author: string | null
  date: string | null
  url: string
  keys: string[]
}

export interface IssueElsewhere {
  key: string
  summary: string
  status: string
  url: string
  fixVersions: { id: string; name: string; released: boolean; releaseDate: string | null }[]
}

export interface CodeComparison {
  release: { id: string; name: string; version: string }
  jira: { versionName: string; url: string; truncated: boolean } | null
  repos: { repo: string; baseRef: string; headRef: string; totalCommits: number; truncated: boolean; compareUrl: string; error: string | null }[]
  matched: { issue: JiraIssue; changes: CodeChange[] }[]
  jiraOnly: JiraIssue[]
  /** jira: the issue as Jira has it, null if it doesn't exist, "unknown" if it wasn't looked up. */
  codeOnly: { key: string; changes: CodeChange[]; jira: IssueElsewhere | null | 'unknown' }[]
  noKey: CodeChange[]
  otherCommits: CodeChange[]
  syncMerges: CodeChange[]
  notes: string[]
  comparedAt: string
}

export const getCodeRefs = (releaseId: string) => api.get<CodeRefs>(`/releases/${releaseId}/code-refs`)
export const saveCodeRefs = (releaseId: string, refs: { repo: string; baseRef: string; headRef: string }[]) =>
  api.put(`/releases/${releaseId}/code-refs`, { refs })
export const getCodeComparison = (releaseId: string, refresh = false) =>
  api.get<CodeComparison>(`/releases/${releaseId}/code-compare${refresh ? '?refresh=true' : ''}`)
