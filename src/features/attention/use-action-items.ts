import { useMemo } from 'react'
import { useReleases } from '@/features/releases/queries'
import { useToday } from '@/hooks/use-today'
import { buildActionItems } from '@/lib/action-items'
import { parseDay } from '@/lib/dates'

/**
 * Action items across releases not yet deployed: one project's, or (no
 * projectId) every project the user belongs to.
 */
export function useActionItems(projectId?: string) {
  const today = useToday()
  const query = useReleases({ open: true, projectId })
  const items = useMemo(
    () => (query.data ? buildActionItems(query.data, parseDay(today)) : []),
    [query.data, today],
  )
  return { ...query, items }
}
