import type { ReactNode } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { SprintStatusBadge } from '@/components/status-badges'
import { formatDay, formatDayRange, parseDay } from '@/lib/dates'
import type { Sprint } from '@/types/domain'

function sprintTiming(sprint: Sprint, today: string) {
  const start = parseDay(sprint.start_date)
  const end = parseDay(sprint.end_date)
  const now = parseDay(today)
  const length = differenceInCalendarDays(end, start) + 1
  const day = differenceInCalendarDays(now, start) + 1
  if (day < 1) return { label: `Starts in ${1 - day} day${day === 0 ? '' : 's'}`, progress: 0 }
  if (day > length) return { label: `Ended ${formatDay(sprint.end_date)}`, progress: 1 }
  const left = length - day
  return { label: `Day ${day} of ${length} · ${left === 0 ? 'last day' : `${left} day${left === 1 ? '' : 's'} left`}`, progress: day / length }
}

export function SprintOverview({ sprint, today, actions }: { sprint: Sprint; today: string; actions?: ReactNode }) {
  const timing = sprintTiming(sprint, today)
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{sprint.name}</h1>
          <SprintStatusBadge status={sprint.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="tabular-nums">{formatDayRange(sprint.start_date, sprint.end_date)}</span>
          <span className="flex items-center gap-2">
            <span
              className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label="Sprint elapsed"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(timing.progress * 100)}
            >
              <span className="block h-full rounded-full bg-foreground/60" style={{ width: `${timing.progress * 100}%` }} />
            </span>
            <span className="tabular-nums">{timing.label}</span>
          </span>
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
