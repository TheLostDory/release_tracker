import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateRuns } from '@/features/integrations/queries'
import { releaseKeys } from '@/features/releases/queries'
import * as api from './api'

export const automationKeys = {
  project: (projectId: string) => ['automation', projectId] as const,
}

export function useAutomation(projectId: string | undefined) {
  return useQuery({ queryKey: automationKeys.project(projectId ?? ''), queryFn: () => api.getAutomation(projectId!), enabled: !!projectId })
}

export function useSaveAutomation(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: api.AutomationSettings) => api.saveAutomation(projectId, settings),
    onSuccess: () => void qc.invalidateQueries({ queryKey: automationKeys.project(projectId) }),
  })
}

export function usePlanDates(releaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.planReleaseDates(releaseId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: releaseKeys.detail(releaseId) })
      void qc.invalidateQueries({ queryKey: releaseKeys.lists() })
    },
  })
}

// --- Starting the automated Jenkins jobs ---------------------------------------------------

export const startKeys = (releaseId: string) => ['jenkins-starts', releaseId] as const

/** Pending starts; checked every 5 s while any is still on its way (then the runs list refreshes). */
export function useJenkinsStarts(releaseId: string, enabled: boolean) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: startKeys(releaseId),
    queryFn: async () => {
      const before = qc.getQueryData<api.JenkinsStart[]>(startKeys(releaseId))
      const starts = await api.listJenkinsStarts(releaseId)
      // A start that disappeared became a run.
      if (before && before.some((b) => !starts.some((s) => s.id === b.id))) invalidateRuns(qc, releaseId)
      return starts
    },
    enabled,
    refetchInterval: (q) => (q.state.data?.some((s) => s.state !== 'failed') ? 5_000 : false),
  })
}

export function useStartJenkinsJobs(releaseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.startJenkinsJobs(releaseId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: startKeys(releaseId) })
      invalidateRuns(qc, releaseId)
    },
  })
}

export function useDismissJenkinsStart(releaseId: string) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.dismissJenkinsStart, onSuccess: () => void qc.invalidateQueries({ queryKey: startKeys(releaseId) }) })
}

// --- Failed tests → Jira bugs --------------------------------------------------------------

export function useTestAnalyses(releaseId: string) {
  return useQuery({
    queryKey: ['test-analyses', releaseId],
    queryFn: () => api.listTestAnalyses(releaseId),
    // While a report is being read, check again every 5 s.
    refetchInterval: (q) => (q.state.data?.some((a) => a.state === 'pending') ? 5_000 : false),
  })
}

export function useAnalyzeRun(releaseId: string) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.analyzeRun, onSettled: () => void qc.invalidateQueries({ queryKey: ['test-analyses', releaseId] }) })
}
