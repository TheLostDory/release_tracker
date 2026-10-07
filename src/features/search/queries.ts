import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { searchReleases } from './api'

export function useReleaseSearch(input: string) {
  const q = useDebouncedValue(input.trim(), 150)
  return useQuery({
    queryKey: ['search', 'releases', q],
    queryFn: ({ signal }) => searchReleases(q, signal),
    enabled: q.length > 0,
    staleTime: 30_000,
    // Keep the previous results on screen while the next query loads.
    placeholderData: keepPreviousData,
  })
}
