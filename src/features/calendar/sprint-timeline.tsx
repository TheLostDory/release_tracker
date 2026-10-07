import { Link } from 'react-router'
import { TriangleAlert } from 'lucide-react'
import { isWeekend } from 'date-fns'
import type { CalendarEvent, Conflict } from '@/lib/calendar-events'
import { formatDay, parseDay, type DayString } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { EventChip } from './event-chip'

interface Props {
  days: readonly DayString[]
  releases: readonly { id: string; name: string; version: string }[]
  events: readonly CalendarEvent[]
  conflicts: ReadonlyMap<DayString, readonly Conflict[]>
  ownerNames: ReadonlyMap<string, string>
  today: DayString
}

/**
 * Swimlanes: one row per release, one column per day. Reading down a column
 * shows everything happening that day across releases, so overlaps stand out.
 */
export function SprintTimeline({ days, releases, events, conflicts, ownerNames, today }: Props) {
  const cell = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    const key = `${e.releaseId}|${e.day}`
    const list = cell.get(key)
    if (list) list.push(e)
    else cell.set(key, [e])
  }

  const columns = `9rem repeat(${days.length}, minmax(6.5rem, 1fr))`

  return (
    <div className="overflow-x-auto rounded-lg border" role="region" aria-label="Sprint timeline" tabIndex={0}>
      <div className="grid min-w-max text-sm" style={{ gridTemplateColumns: columns }} role="table">
        <div role="row" className="contents">
          <div role="columnheader" className="sticky left-0 z-10 border-b bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
            Release
          </div>
          {days.map((day) => {
            const dayConflicts = conflicts.get(day)
            const isToday = day === today
            return (
              <div
                key={day}
                role="columnheader"
                className={cn(
                  'border-b border-l px-2 py-1.5 text-xs',
                  isWeekend(parseDay(day)) && 'bg-muted/50',
                  isToday && 'bg-blue-500/10',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className={cn('tabular-nums', isToday ? 'font-semibold text-blue-700 dark:text-blue-400' : 'text-muted-foreground')}>
                    {formatDay(day, 'EEE d')}
                  </span>
                  {dayConflicts && (
                    <TriangleAlert
                      className="size-3.5 text-amber-600"
                      aria-label={dayConflicts.map((c) => c.message).join('; ')}
                    >
                      <title>{dayConflicts.map((c) => c.message).join('\n')}</title>
                    </TriangleAlert>
                  )}
                </div>
                {isToday && <span className="text-[10px] font-medium text-blue-700 dark:text-blue-400">Today</span>}
              </div>
            )
          })}
        </div>

        {releases.map((r) => (
          <div role="row" key={r.id} className="contents">
            <div role="rowheader" className="sticky left-0 z-10 border-b bg-background px-3 py-2">
              <Link to={`/releases/${r.id}`} className="font-medium hover:underline">
                {r.name}
              </Link>
              <div className="font-mono text-[11px] text-muted-foreground">{r.version}</div>
            </div>
            {days.map((day) => {
              const items = cell.get(`${r.id}|${day}`) ?? []
              return (
                <div
                  key={day}
                  role="cell"
                  className={cn(
                    'flex min-h-14 flex-col gap-1 border-b border-l p-1',
                    isWeekend(parseDay(day)) && 'bg-muted/30',
                    day === today && 'bg-blue-500/5',
                  )}
                >
                  {items.map((e) => (
                    <EventChip key={e.id} event={e} ownerName={e.ownerId ? ownerNames.get(e.ownerId) : undefined} />
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
