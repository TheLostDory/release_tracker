import { dueTone, formatDay, relativeDayLabel, type DueTone } from '@/lib/dates'
import { cn } from '@/lib/utils'

const TONE_CLASS: Record<DueTone, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-amber-700 dark:text-amber-400',
  soon: 'text-foreground',
  normal: 'text-muted-foreground',
}

/** Due date coloured by urgency: overdue red, today amber, otherwise muted. */
export function DueDate({ day, className, showDate = false }: { day: string; className?: string; showDate?: boolean }) {
  const tone = dueTone(day)
  const label = tone === 'overdue' ? `Overdue · ${formatDay(day)}` : relativeDayLabel(day)
  return (
    <span className={cn(TONE_CLASS[tone], className)} title={formatDay(day, 'EEE, MMM d, yyyy')}>
      {showDate && tone !== 'overdue' ? `${formatDay(day)} · ${label}` : label}
    </span>
  )
}
