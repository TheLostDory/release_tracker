import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isValid,
  isWeekend,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { PageTitle } from '@/components/page-title'
import { QueryError } from '@/components/query-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Agenda } from '@/features/calendar/agenda'
import { EventChip, EventLegend } from '@/features/calendar/event-chip'
import { useCalendarEvents } from '@/features/calendar/use-calendar-events'
import { useReleases } from '@/features/releases/queries'
import { useToday } from '@/hooks/use-today'
import { dayRange, formatDay, parseDay, toDayString, type DayString } from '@/lib/dates'
import { cn } from '@/lib/utils'

const WEEK = { weekStartsOn: 1 } as const
const MAX_CHIPS = 3
/** Steps happen before deployment; fetch releases deploying up to this long after the grid. */
const LOOKAHEAD_DAYS = 45

/** "yyyy-MM" from the URL, falling back to the month containing `today`. */
function monthKey(value: string | null, today: DayString): string {
  if (value && isValid(parse(value, 'yyyy-MM', parseDay(today)))) return value
  return today.slice(0, 7)
}

export default function CalendarPage() {
  const [params, setParams] = useSearchParams()
  const todayKey = useToday()
  const key = monthKey(params.get('month'), todayKey)
  // Keyed by string so memos below stay stable across renders.
  const month = useMemo(() => startOfMonth(parseDay(`${key}-01`)), [key])
  const gridStart = toDayString(startOfWeek(month, WEEK))
  const gridEnd = toDayString(endOfWeek(endOfMonth(month), WEEK))

  const releases = useReleases({
    deploymentFrom: gridStart,
    deploymentTo: toDayString(addDays(parseDay(gridEnd), LOOKAHEAD_DAYS)),
  })
  const { byDay, conflicts, ownerNames, today } = useCalendarEvents(releases.data)
  const days = useMemo(() => dayRange(gridStart, gridEnd), [gridStart, gridEnd])
  const monthDays = useMemo(() => days.filter((d) => isSameMonth(parseDay(d), month)), [days, month])

  const dayParam = params.get('day')
  const selected: DayString =
    dayParam && days.includes(dayParam) ? dayParam : days.includes(today) ? today : (monthDays[0] ?? gridStart)

  function update(next: Record<string, string | null>) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v)
          else p.delete(k)
        }
        return p
      },
      { replace: true },
    )
  }

  const goToMonth = (d: Date) => update({ month: format(d, 'yyyy-MM'), day: null })

  return (
    <>
      <PageTitle title={`Calendar · ${format(month, 'MMMM yyyy')}`} />
      <PageHeader
        title={format(month, 'MMMM yyyy')}
        actions={
          <>
            <Button size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => goToMonth(addMonths(month, -1))}>
              <ChevronLeft />
            </Button>
            <Button size="sm" variant="outline" onClick={() => update({ month: null, day: null })}>
              Today
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="Next month" onClick={() => goToMonth(addMonths(month, 1))}>
              <ChevronRight />
            </Button>
          </>
        }
      />

      <div className="mb-3">
        <EventLegend />
      </div>

      {releases.error ? (
        <QueryError error={releases.error} onRetry={() => void releases.refetch()} />
      ) : releases.isLoading ? (
        <Skeleton className="h-[36rem] w-full" />
      ) : (
        <>
          {/* Phones: a list is more usable than a 7-column grid. */}
          <div className="md:hidden">
            <Agenda
              days={monthDays}
              byDay={byDay}
              conflicts={conflicts}
              ownerNames={ownerNames}
              today={today}
              emptyLabel="Nothing scheduled this month."
            />
          </div>

          <div className="hidden gap-4 md:grid xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-7 border-b bg-muted/40 text-xs text-muted-foreground">
                {days.slice(0, 7).map((d) => (
                  <div key={d} className="px-2 py-1.5">
                    {formatDay(d, 'EEE')}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const date = parseDay(day)
                  const events = byDay.get(day) ?? []
                  const dayConflicts = conflicts.get(day)
                  const inMonth = isSameMonth(date, month)
                  const isToday = day === today
                  const isSelected = day === selected
                  const hidden = events.length - MAX_CHIPS
                  return (
                    <div
                      key={day}
                      className={cn(
                        'flex min-h-28 min-w-0 flex-col gap-1 border-b border-l p-1 first:border-l-0 [&:nth-child(7n+1)]:border-l-0',
                        !inMonth && 'bg-muted/30 text-muted-foreground',
                        inMonth && isWeekend(date) && 'bg-muted/20',
                        isSelected && 'ring-2 ring-foreground/30 ring-inset',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => update({ day })}
                          aria-label={`${formatDay(day, 'EEEE, MMMM d')}${events.length ? `, ${events.length} items` : ''}`}
                          aria-pressed={isSelected}
                          className={cn(
                            'flex size-6 items-center justify-center rounded-full text-xs tabular-nums hover:bg-muted',
                            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                            isToday && 'bg-blue-600 font-semibold text-white hover:bg-blue-600',
                          )}
                        >
                          {date.getDate()}
                        </button>
                        {dayConflicts && (
                          <TriangleAlert className="size-3.5 text-amber-600" aria-label={dayConflicts.map((c) => c.message).join('; ')}>
                            <title>{dayConflicts.map((c) => c.message).join('\n')}</title>
                          </TriangleAlert>
                        )}
                      </div>
                      {events.slice(0, MAX_CHIPS).map((e) => (
                        <EventChip
                          key={e.id}
                          event={e}
                          showRelease
                          ownerName={e.ownerId ? ownerNames.get(e.ownerId) : undefined}
                        />
                      ))}
                      {hidden > 0 && (
                        <button
                          type="button"
                          onClick={() => update({ day })}
                          className="rounded px-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          +{hidden} more
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <aside aria-label={`Schedule for ${formatDay(selected, 'MMMM d')}`} className="space-y-2">
              <h2 className="text-sm font-medium">{formatDay(selected, 'EEEE, MMMM d')}</h2>
              <Agenda
                days={[selected]}
                byDay={byDay}
                conflicts={conflicts}
                ownerNames={ownerNames}
                today={today}
                emptyLabel="Nothing scheduled on this day."
              />
            </aside>
          </div>
        </>
      )}
    </>
  )
}
