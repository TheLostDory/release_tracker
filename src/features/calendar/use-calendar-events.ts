import { useMemo } from 'react'
import { useProfiles } from '@/features/profiles/queries'
import { useToday } from '@/hooks/use-today'
import { buildCalendarEvents, detectConflicts, groupByDay, type EventRelease } from '@/lib/calendar-events'
import { parseDay } from '@/lib/dates'

/** Events, per-day grouping and conflicts for a set of releases. */
export function useCalendarEvents(releases: readonly EventRelease[] | undefined) {
  const today = useToday()
  const { data: profiles = [] } = useProfiles()
  const ownerNames = useMemo(() => new Map(profiles.map((p) => [p.id, p.name])), [profiles])

  return useMemo(() => {
    const events = releases ? buildCalendarEvents(releases, parseDay(today)) : []
    const byDay = groupByDay(events)
    const conflicts = detectConflicts(byDay, (id) => ownerNames.get(id) ?? 'Someone')
    return { today, events, byDay, conflicts, ownerNames }
  }, [releases, today, ownerNames])
}
