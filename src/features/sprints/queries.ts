import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SprintWithCount } from '@/types/domain'
import { createSprint, deleteSprint, listSprints, updateSprint, type SprintInput } from './api'

export const sprintKeys = {
  all: ['sprints'] as const,
  list: () => [...sprintKeys.all, 'list'] as const,
}

export function useSprints() {
  return useQuery({
    queryKey: sprintKeys.list(),
    queryFn: listSprints,
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
export function useUpdateSprint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SprintInput> }) => updateSprint(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: sprintKeys.list() })
      const previous = qc.getQueryData<SprintWithCount[]>(sprintKeys.list())
      qc.setQueryData<SprintWithCount[]>(sprintKeys.list(), (old) =>
        old?.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(sprintKeys.list(), ctx.previous)
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
