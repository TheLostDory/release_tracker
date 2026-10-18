import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { releaseKeys } from '@/features/releases/queries'
import * as api from './api'

export const integrationKeys = {
  all: ['integrations'] as const,
  project: (projectId: string) => [...integrationKeys.all, 'project', projectId] as const,
  jiraVersions: (projectId: string) => [...integrationKeys.all, 'jira-versions', projectId] as const,
  jiraIssues: (releaseId: string) => [...integrationKeys.all, 'jira-issues', releaseId] as const,
  jenkinsJobs: (releaseId: string) => [...integrationKeys.all, 'jenkins', releaseId] as const,
  jenkinsBuilds: (jobId: string) => [...integrationKeys.all, 'jenkins-builds', jobId] as const,
  followedBuilds: (releaseId: string) => [...integrationKeys.all, 'jenkins-followed', releaseId] as const,
  followedBuild: (id: string) => [...integrationKeys.all, 'jenkins-followed-build', id] as const,
}

export function useIntegrations(projectId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.project(projectId ?? ''),
    queryFn: () => api.listIntegrations(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  })
}

/** Which integrations a project has (for showing/hiding sections). */
export function useConnected(projectId: string | undefined) {
  const { data = [] } = useIntegrations(projectId)
  return { jira: data.find((i) => i.kind === 'JIRA') ?? null, jenkins: data.find((i) => i.kind === 'JENKINS') ?? null }
}

export function useSaveIntegration(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, input }: { kind: api.IntegrationKind; input: api.SaveIntegrationInput }) =>
      api.saveIntegration(projectId, kind, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: integrationKeys.all }),
  })
}

export function useTestIntegration(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (kind: api.IntegrationKind) => api.testIntegration(projectId, kind),
    onSettled: () => void qc.invalidateQueries({ queryKey: integrationKeys.project(projectId) }),
  })
}

export function useDeleteIntegration(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (kind: api.IntegrationKind) => api.deleteIntegration(projectId, kind),
    onSuccess: () => void qc.invalidateQueries({ queryKey: integrationKeys.all }),
  })
}

export function useJiraVersions(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: integrationKeys.jiraVersions(projectId ?? ''),
    queryFn: () => api.listJiraVersions(projectId!),
    enabled: !!projectId && enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function useImportJiraVersions(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ versionIds, sprintId }: { versionIds: string[]; sprintId: string | null }) =>
      api.importJiraVersions(projectId, versionIds, sprintId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: integrationKeys.jiraVersions(projectId) })
      void qc.invalidateQueries({ queryKey: releaseKeys.all })
    },
  })
}

export function useLinkJiraVersion(releaseId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (versionId: string | null) => api.linkJiraVersion(releaseId, versionId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: integrationKeys.jiraIssues(releaseId) })
      void qc.invalidateQueries({ queryKey: integrationKeys.jiraVersions(projectId) })
      void qc.invalidateQueries({ queryKey: releaseKeys.detail(releaseId) })
    },
  })
}

export function useJiraIssues(releaseId: string, enabled: boolean) {
  return useQuery({
    queryKey: integrationKeys.jiraIssues(releaseId),
    queryFn: () => api.getJiraIssues(releaseId),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function useJenkinsJobs(releaseId: string, enabled: boolean) {
  return useQuery({
    queryKey: integrationKeys.jenkinsJobs(releaseId),
    queryFn: () => api.listJenkinsJobs(releaseId),
    enabled,
  })
}

export function useJenkinsBuilds(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: integrationKeys.jenkinsBuilds(jobId),
    queryFn: () => api.listJenkinsBuilds(jobId),
    enabled,
    retry: false,
  })
}

/** Jenkins writes can change the workflow too: refresh both. */
function useRefreshJenkins(releaseId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: integrationKeys.jenkinsJobs(releaseId) })
    void qc.invalidateQueries({ queryKey: releaseKeys.detail(releaseId) })
    void qc.invalidateQueries({ queryKey: releaseKeys.activity(releaseId) })
  }
}

export function useLinkJenkinsJob(releaseId: string) {
  const refresh = useRefreshJenkins(releaseId)
  return useMutation({
    mutationFn: (input: Parameters<typeof api.linkJenkinsJob>[1]) => api.linkJenkinsJob(releaseId, input),
    onSuccess: refresh,
  })
}

export function useUnlinkJenkinsJob(releaseId: string) {
  const refresh = useRefreshJenkins(releaseId)
  return useMutation({ mutationFn: api.unlinkJenkinsJob, onSuccess: refresh })
}

export function useRunJenkinsJob(releaseId: string) {
  const refresh = useRefreshJenkins(releaseId)
  return useMutation({ mutationFn: api.runJenkinsJob, onSuccess: refresh })
}

export function useSyncJenkins(releaseId: string) {
  const refresh = useRefreshJenkins(releaseId)
  return useMutation({ mutationFn: () => api.syncJenkins(releaseId), onSuccess: refresh })
}

// --- Followed builds -------------------------------------------------------------------

export function useFollowedBuilds(releaseId: string, enabled: boolean) {
  return useQuery({ queryKey: integrationKeys.followedBuilds(releaseId), queryFn: () => api.listFollowedBuilds(releaseId), enabled })
}

/**
 * Live status of one followed build: asks Jenkins on open, then every 15 s
 * while anything in the tree is still running or queued.
 */
export function useFollowedBuildStatus(followed: api.FollowedBuild) {
  return useQuery({
    queryKey: integrationKeys.followedBuild(followed.id),
    queryFn: () => api.refreshFollowedBuild(followed.id),
    placeholderData: followed,
    retry: false,
    refetchInterval: (q) => (isActive((q.state.data ?? followed).status) ? 15_000 : false),
  })
}

export function isActive(node: api.BuildNode | null): boolean {
  return !!node && (node.building || node.queued || node.children.some(isActive))
}

export function useFollowBuild(releaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { url: string; label?: string | null }) => api.followBuild(releaseId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: integrationKeys.followedBuilds(releaseId) }),
  })
}

export function useUnfollowBuild(releaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.unfollowBuild,
    onSuccess: () => void qc.invalidateQueries({ queryKey: integrationKeys.followedBuilds(releaseId) }),
  })
}
