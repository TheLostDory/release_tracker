import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { releaseKeys } from '@/features/releases/queries'
import { listProfiles, updateMyName } from './api'

export const profileKeys = {
  all: ['profiles'] as const,
}

export function useProfiles() {
  return useQuery({ queryKey: profileKeys.all, queryFn: listProfiles, staleTime: 10 * 60_000 })
}

export function useUpdateMyName() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateMyName(id, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKeys.all })
      // Owner names are embedded in release queries.
      void qc.invalidateQueries({ queryKey: releaseKeys.all })
    },
  })
}
