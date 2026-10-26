import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
