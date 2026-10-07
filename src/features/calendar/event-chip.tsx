import { Link } from 'react-router'
import { Ban, Check, Clock, Rocket, TimerOff } from 'lucide-react'
import type { CalendarEvent, EventState } from '@/lib/calendar-events'
import { cn } from '@/lib/utils'

const STATE: Record<EventState, { className: string; label: string }> = {
  done: { className: 'border-transparent bg-emerald-500/10 text-emerald-800 dark:text-emerald-300', label: 'done' },
  overdue: { className: 'border-red-500/50 bg-red-500/5 text-red-700 dark:text-red-300', label: 'overdue' },
  today: { className: 'border-amber-500/60 bg-amber-500/5 text-amber-800 dark:text-amber-300', label: 'due today' },
  blocked: { className: 'border-transparent bg-red-600 text-white', label: 'blocked' },
  open: { className: 'border-border bg-background text-foreground', label: 'planned' },
}

function StateIcon({ event }: { event: CalendarEvent }) {
  const cls = 'size-3 shrink-0'
  if (event.kind === 'target') return <Rocket className={cls} aria-hidden />
  switch (event.state) {
    case 'done':
      return <Check className={cls} strokeWidth={3} aria-hidden />
    case 'overdue':
      return <TimerOff className={cls} aria-hidden />
    case 'today':
      return <Clock className={cls} aria-hidden />
    case 'blocked':
      return <Ban className={cls} aria-hidden />
    default:
      return null
  }
}

interface Props {
  event: CalendarEvent
  /** Prefix the release name (needed when several releases share a view). */
  showRelease?: boolean
  ownerName?: string
  className?: string
}

export function EventChip({ event, showRelease = false, ownerName, className }: Props) {
  const state = STATE[event.state]
  const text = showRelease ? `${event.releaseName} · ${event.short}` : event.short
  const title = [`${event.releaseName}: ${event.label}`, state.label, ownerName].filter(Boolean).join(' · ')
  return (
    <Link
      to={`/releases/${event.releaseId}`}
      title={title}
      aria-label={title}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-4 hover:brightness-95',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        state.className,
        event.kind === 'target' && 'font-semibold',
        event.kind === 'target' && event.state === 'open' && 'border-foreground/40',
        className,
      )}
    >
      <StateIcon event={event} />
      <span className="truncate">{text}</span>
    </Link>
  )
}

export function EventLegend() {
  const items: { state: EventState; label: string }[] = [
    { state: 'done', label: 'Done' },
    { state: 'open', label: 'Planned' },
    { state: 'today', label: 'Due today' },
    { state: 'overdue', label: 'Overdue' },
    { state: 'blocked', label: 'Blocked' },
  ]
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {items.map((i) => (
        <li key={i.state} className="flex items-center gap-1.5">
          <span className={cn('inline-block h-3 w-5 rounded-sm border', STATE[i.state].className)} aria-hidden />
          {i.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <Rocket className="size-3" aria-hidden /> Deployment
      </li>
    </ul>
  )
}
