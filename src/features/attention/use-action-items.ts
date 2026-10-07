import { useMemo } from 'react'
import { useReleases } from '@/features/releases/queries'
import { useToday } from '@/hooks/use-today'
import { buildActionItems } from '@/lib/action-items'
import { parseDay } from '@/lib/dates'

/** Action items across every release not yet deployed (all sprints). */
export function useActionItems() {
  const today = useToday()
  const query = useReleases({ open: true })
  const items = useMemo(
    () => (query.data ? buildActionItems(query.data, parseDay(today)) : []),
    [query.data, today],
  )
  return { ...query, items }
}
