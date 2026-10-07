import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import type { ReleaseListItem } from '@/features/releases/api'
import { dayRange, type DayString } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { Sprint } from '@/types/domain'
import { Agenda } from './agenda'
import { EventLegend } from './event-chip'
import { SprintTimeline } from './sprint-timeline'
import { useCalendarEvents } from './use-calendar-events'

/** Longest range the timeline will draw; beyond this, events are cut off. */
const MAX_DAYS = 42

/** Sprint dates, widened to include steps that fall just outside them. */
function scheduleRange(sprint: Sprint, eventDays: readonly DayString[]): [DayString, DayString] {
  let start = sprint.start_date
  let end = sprint.end_date
  for (const d of eventDays) {
    if (d < start) start = d
    if (d > end) end = d
  }
  return [start, end]
}

export function SprintSchedule({ sprint, releases }: { sprint: Sprint; releases: readonly ReleaseListItem[] }) {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'agenda' ? 'agenda' : 'timeline'
  const { events, byDay, conflicts, ownerNames, today } = useCalendarEvents(releases)

  const days = useMemo(() => {
    const [start, end] = scheduleRange(sprint, [...byDay.keys()])
    return dayRange(start, end).slice(0, MAX_DAYS)
  }, [sprint, byDay])

  function setView(next: 'timeline' | 'agenda') {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'agenda') p.set('view', 'agenda')
        else p.delete('view')
        return p
      },
      { replace: true },
    )
  }

  return (
    <section aria-labelledby="schedule-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="schedule-heading" className="text-sm font-medium text-muted-foreground">
          Schedule
          {conflicts.size > 0 && (
            <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
              {conflicts.size} day{conflicts.size === 1 ? '' : 's'} with overlapping work
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <div className="hidden md:block">
            <EventLegend />
          </div>
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Schedule view">
            {(['timeline', 'agenda'] as const).map((v) => (
              <Button
                key={v}
                size="xs"
                variant="ghost"
                aria-pressed={view === v}
                className={cn('h-6 px-2 capitalize', view === v && 'bg-muted')}
                onClick={() => setView(v)}
              >
                {v}
              </Button>
            ))}
          </div>
        </div>
      </div>
      {view === 'timeline' ? (
        <SprintTimeline
          days={days}
          releases={releases}
          events={events}
          conflicts={conflicts}
          ownerNames={ownerNames}
          today={today}
        />
      ) : (
        <Agenda days={days} byDay={byDay} conflicts={conflicts} ownerNames={ownerNames} today={today} />
      )}
    </section>
  )
}
