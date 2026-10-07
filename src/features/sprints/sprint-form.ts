import { addDays, differenceInCalendarDays, isWeekend, nextMonday } from 'date-fns'
import { parseDay, toDayString } from '@/lib/dates'
import type { Sprint } from '@/types/domain'
import type { SprintInput } from './api'

export type SprintFormErrors = Partial<Record<keyof SprintInput, string>>

export function validateSprint(values: SprintInput): SprintFormErrors {
  const errors: SprintFormErrors = {}
  if (!values.name.trim()) errors.name = 'Name is required.'
  else if (values.name.trim().length > 100) errors.name = 'Keep the name under 100 characters.'
  if (!values.start_date) errors.start_date = 'Start date is required.'
  if (!values.end_date) errors.end_date = 'End date is required.'
  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    errors.end_date = 'End date must be on or after the start date.'
  }
  return errors
}

const DEFAULT_SPRINT_DAYS = 12 // two working weeks, Monday to the following Friday

/**
 * Pre-fills the "new sprint" form from the latest sprint: increments a
 * trailing number in the name ("Sprint 42" → "Sprint 43"), starts on the
 * first weekday after it ends and keeps the same length.
 * `sprints` must be sorted by start_date descending.
 */
export function suggestNextSprint(sprints: readonly Sprint[], today = new Date()): SprintInput {
  const latest = sprints[0]
  if (!latest) {
    const start = isWeekend(today) ? nextMonday(today) : today
    return {
      name: 'Sprint 1',
      start_date: toDayString(start),
      end_date: toDayString(addDays(start, DEFAULT_SPRINT_DAYS - 1)),
      status: 'PLANNED',
    }
  }

  const match = /^(.*?)(\d+)\s*$/.exec(latest.name)
  const name = match ? `${match[1]}${Number(match[2]) + 1}` : ''
  const afterLatest = addDays(parseDay(latest.end_date), 1)
  const start = isWeekend(afterLatest) ? nextMonday(afterLatest) : afterLatest
  const length = differenceInCalendarDays(parseDay(latest.end_date), parseDay(latest.start_date))

  return {
    name,
    start_date: toDayString(start),
    end_date: toDayString(addDays(start, length)),
    status: 'PLANNED',
  }
}
