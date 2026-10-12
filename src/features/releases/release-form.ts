import type { Sprint } from '@/types/domain'
import type { ReleaseInput } from './api'

export type ReleaseFormErrors = Partial<Record<keyof ReleaseInput, string>>

export function validateRelease(values: ReleaseInput): ReleaseFormErrors {
  const errors: ReleaseFormErrors = {}
  const name = values.name.trim()
  const version = values.version.trim()
  if (!name) errors.name = 'Name is required.'
  else if (name.length > 100) errors.name = 'Keep the name under 100 characters.'
  if (!version) errors.version = 'Version is required.'
  else if (version.length > 50) errors.version = 'Keep the version under 50 characters.'
  if (!values.planned_deployment_date) errors.planned_deployment_date = 'Target deployment date is required.'
  if ((values.description?.length ?? 0) > 10_000) errors.description = 'Description is too long.'
  return errors
}

/** Trims text fields and turns blank optionals into null before saving. */
export function normalizeRelease(values: ReleaseInput): ReleaseInput {
  const description = values.description?.trim() ?? ''
  return {
    ...values,
    name: values.name.trim(),
    version: values.version.trim(),
    owner_id: values.owner_id || null,
    sprint_id: values.sprint_id || null,
    description: description || null,
  }
}

/** Non-blocking warning: the target date falls outside the sprint. */
export function targetOutsideSprint(target: string, sprint: Pick<Sprint, 'start_date' | 'end_date'> | undefined): boolean {
  if (!target || !sprint) return false
  return target < sprint.start_date || target > sprint.end_date
}
