/** Postgres / PostgREST error codes we translate for users. */
const PG_UNIQUE_VIOLATION = '23505'
const PG_FOREIGN_KEY_VIOLATION = '23503'
const PG_CHECK_VIOLATION = '23514'
const PG_RLS_VIOLATION = '42501'

interface ErrorLike {
  code?: unknown
  message?: unknown
  details?: unknown
}

/** Messages for specific constraint names, checked before generic codes. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  sprints_name_key: 'A sprint with this name already exists.',
  sprints_single_active_idx: 'Another sprint is already active. Mark it completed first.',
  sprints_dates_check: 'The end date must be on or after the start date.',
  releases_name_per_sprint_unique: 'A release with this name already exists in this sprint.',
  releases_sprint_id_fkey: 'This sprint still has releases. Move or delete them first.',
  release_tasks_link_check: 'Links must start with http:// or https://.',
  reports_url_check: 'Report URLs must start with http:// or https://.',
}

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === 'object' && value !== null
}

/** Turns a Supabase/Postgres error into a short message safe to show users. */
export function toUserMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!isErrorLike(error)) return fallback
  const text = `${String(error.message ?? '')} ${String(error.details ?? '')}`

  for (const [constraint, message] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (text.includes(constraint)) return message
  }

  switch (error.code) {
    case PG_UNIQUE_VIOLATION:
      return 'That already exists.'
    case PG_FOREIGN_KEY_VIOLATION:
      return 'This item is still referenced by other records.'
    case PG_CHECK_VIOLATION:
      return 'Some values are invalid.'
    case PG_RLS_VIOLATION:
      return "You don't have permission to do that."
  }
  return typeof error.message === 'string' && error.message ? error.message : fallback
}
