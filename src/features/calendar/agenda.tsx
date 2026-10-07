import { TriangleAlert } from 'lucide-react'
import type { CalendarEvent, Conflict } from '@/lib/calendar-events'
import { formatDay, relativeDayLabel, type DayString } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { EventChip } from './event-chip'

interface Props {
  days: readonly DayString[]
  byDay: ReadonlyMap<DayString, readonly CalendarEvent[]>
  conflicts: ReadonlyMap<DayString, readonly Conflict[]>
  ownerNames: ReadonlyMap<string, string>
  today: DayString
  emptyLabel?: string
}

/** Day-by-day list: "Oct 9 — RC_1 jobs, RC_2 created". Days without events are skipped. */
export function Agenda({ days, byDay, conflicts, ownerNames, today, emptyLabel = 'Nothing scheduled.' }: Props) {
  const withEvents = days.filter((d) => byDay.has(d))
  if (withEvents.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>

  return (
    <ol className="divide-y rounded-lg border">
      {withEvents.map((day) => {
        const dayConflicts = conflicts.get(day) ?? []
        const isToday = day === today
        return (
          <li key={day} className={cn('grid gap-2 p-3 sm:grid-cols-[8rem_minmax(0,1fr)]', isToday && 'bg-blue-500/5')}>
            <div>
              <div className={cn('text-sm font-medium tabular-nums', isToday && 'text-blue-700 dark:text-blue-400')}>
                {formatDay(day, 'EEE, MMM d')}
              </div>
              <div className="text-xs text-muted-foreground">{relativeDayLabel(day)}</div>
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {byDay.get(day)!.map((e) => (
                  <EventChip key={e.id} event={e} showRelease ownerName={e.ownerId ? ownerNames.get(e.ownerId) : undefined} />
                ))}
              </div>
              {dayConflicts.map((c) => (
                <p key={c.message} className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                  {c.message}
                </p>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
