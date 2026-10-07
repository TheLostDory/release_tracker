import { addDays, differenceInCalendarDays, format, isSameMonth, isSameYear, parseISO } from 'date-fns'

/**
 * Timezone convention
 *
 * - Calendar-day columns (`date` in Postgres: planned dates, sprint bounds,
 *   target deployment) arrive as "YYYY-MM-DD" strings. They have no timezone:
 *   "Oct 13" means Oct 13 for every viewer. Parse them with `parseDay`, which
 *   yields local midnight, and compare them against `today()`.
 * - Point-in-time columns (`timestamptz`: completed_at, reviewed_at, audit
 *   columns) arrive as ISO strings with an offset and are displayed in the
 *   viewer's local timezone.
 */

export type DayString = string

export function parseDay(day: DayString): Date {
  return parseISO(day)
}

export function toDayString(date: Date): DayString {
  return format(date, 'yyyy-MM-dd')
}

export function formatDay(day: DayString, pattern = 'MMM d'): string {
  return format(parseDay(day), pattern)
}

export function formatDayRange(start: DayString, end: DayString): string {
  const s = parseDay(start)
  const e = parseDay(end)
  if (isSameMonth(s, e)) return `${format(s, 'MMM d')} – ${format(e, 'd')}`
  if (isSameYear(s, e)) return `${format(s, 'MMM d')} – ${format(e, 'MMM d')}`
  return `${format(s, 'MMM d, yyyy')} – ${format(e, 'MMM d, yyyy')}`
}

export function formatTimestamp(iso: string, pattern = 'MMM d HH:mm'): string {
  return format(parseISO(iso), pattern)
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'normal'

/** Calendar-day distance from today: negative = past. */
export function daysFromToday(day: DayString, today = new Date()): number {
  return differenceInCalendarDays(parseDay(day), today)
}

export function dueTone(day: DayString, today = new Date()): DueTone {
  const diff = daysFromToday(day, today)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 2) return 'soon'
  return 'normal'
}

/** "Today", "Tomorrow", "In 3 days", "Yesterday", "2 days overdue". */
export function relativeDayLabel(day: DayString, today = new Date()): string {
  const diff = daysFromToday(day, today)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 0) return `In ${diff} days`
  return `${-diff} days ago`
}

/** Every calendar day from start to end inclusive. */
export function dayRange(start: DayString, end: DayString): DayString[] {
  const days: DayString[] = []
  for (let d = parseDay(start); toDayString(d) <= end; d = addDays(d, 1)) days.push(toDayString(d))
  return days
}
