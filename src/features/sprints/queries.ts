import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SprintWithCount } from '@/types/domain'
import { createSprint, deleteSprint, getSprint, listSprints, updateSprint, type SprintInput } from './api'

export const sprintKeys = {
  all: ['sprints'] as const,
  list: (projectId: string) => [...sprintKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...sprintKeys.all, 'detail', id] as const,
}

export function useSprint(id: string) {
  return useQuery({ queryKey: sprintKeys.detail(id), queryFn: () => getSprint(id), enabled: !!id })
}

export function useSprints(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: sprintKeys.list(projectId ?? ''),
    queryFn: () => listSprints(projectId!),
    enabled: !!projectId && enabled,
    staleTime: 5 * 60_000,
  })
}

export function useCreateSprint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createSprint,
    onSettled: () => void qc.invalidateQueries({ queryKey: sprintKeys.all }),
  })
}

/** Optimistic: the list reflects the edit immediately and rolls back on error. */
export function useUpdateSprint(projectId: string) {
  const qc = useQueryClient()
  const key = sprintKeys.list(projectId)
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<SprintInput, 'project_id'>> }) => updateSprint(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<SprintWithCount[]>(key)
      qc.setQueryData<SprintWithCount[]>(key, (old) => old?.map((s) => (s.id === id ? { ...s, ...patch } : s)))
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: sprintKeys.all }),
  })
}

export function useDeleteSprint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteSprint,
    onSettled: () => void qc.invalidateQueries({ queryKey: sprintKeys.all }),
  })
}
