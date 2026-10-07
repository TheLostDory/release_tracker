import { toDayString } from '@/lib/dates'
import type { Sprint } from '@/types/domain'

/**
 * Default sprint when the user has not picked one: the ACTIVE sprint, else the
 * sprint whose dates contain today, else the most recent one.
 * `sprints` must be sorted by start_date descending.
 */
export function pickDefaultSprint<S extends Sprint>(sprints: readonly S[], today = new Date()): S | null {
  const day = toDayString(today)
  return (
    sprints.find((s) => s.status === 'ACTIVE') ??
    sprints.find((s) => s.start_date <= day && day <= s.end_date) ??
    sprints[0] ??
    null
  )
}
