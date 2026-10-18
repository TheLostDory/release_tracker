import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found')
export const forbidden = (message = "You don't have permission to do that.") => new HttpError(403, message, 'forbidden')

/** Friendly messages for constraint violations (checked before generic codes). */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  release_jenkins_builds_unique: 'This build is already followed on this release.',
  sprints_name_per_project_unique: 'A sprint with this name already exists in this project.',
  sprints_single_active_idx: 'Another sprint is already active. Mark it completed first.',
  sprints_dates_check: 'The end date must be on or after the start date.',
  releases_name_per_sprint_unique: 'A release with this name already exists in this sprint.',
  releases_name_per_project_unique: 'A release with this name already exists in this project.',
  releases_sprint_id_fkey: 'That sprint is not in this project, or still has releases.',
  release_tasks_link_check: 'Links must start with http:// or https://.',
  reports_url_check: 'Report URLs must start with http:// or https://.',
  projects_required_steps: 'Release identified and Deployment are always part of the workflow.',
  users_email_key: 'An account with this email already exists. Sign in instead.',
  users_email_format: 'Enter a valid email address.',
}

interface PgError {
  code?: string
  message?: string
  constraint?: string
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as PgError).code === 'string'
}

/** Postgres error → HTTP status + a message safe to show users. */
export function fromPgError(err: PgError): HttpError {
  const constraintMessage = err.constraint ? CONSTRAINT_MESSAGES[err.constraint] : undefined
  switch (err.code) {
    case '23505':
      return new HttpError(409, constraintMessage ?? 'That already exists.', 'conflict')
    case '23503':
      return new HttpError(409, constraintMessage ?? 'This item is still referenced by other records.', 'conflict')
    case '23514':
      // Our own functions raise check_violation with a human message.
      return new HttpError(422, constraintMessage ?? (err.constraint ? 'Some values are invalid.' : (err.message ?? 'Invalid.')), 'invalid')
    case '42501':
      return new HttpError(
        403,
        !err.message || err.message.includes('row-level security') || err.message.includes('permission denied')
          ? "You don't have permission to do that."
          : err.message,
        'forbidden',
      )
    case 'P0002':
      return new HttpError(404, err.message ?? 'Not found', 'not_found')
    case '22P02':
      return new HttpError(400, 'Malformed id or value.', 'invalid')
    case '22001':
      return new HttpError(422, 'A value is too long.', 'invalid')
    default:
      return new HttpError(500, 'Something went wrong. Please try again.', 'internal')
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let httpError: HttpError
  if (err instanceof HttpError) httpError = err
  else if (err instanceof ZodError) {
    const first = err.issues[0]
    httpError = new HttpError(400, first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request.', 'invalid')
  } else if (isPgError(err)) httpError = fromPgError(err)
  else if (err?.type === 'entity.parse.failed') httpError = new HttpError(400, 'Malformed JSON.', 'invalid')
  else if (err?.type === 'entity.too.large') httpError = new HttpError(413, 'Request too large.', 'invalid')
  else httpError = new HttpError(500, 'Something went wrong. Please try again.', 'internal')

  if (httpError.code === 'integration_error') {
    // Expected (Jira/Jenkins unreachable, bad token…): one line, no stack.
    console.warn(`[api] ${req.method} ${req.path}: ${httpError.message}`)
  } else if (httpError.status >= 500) console.error(`[api] ${req.method} ${req.path}`, err)
  res.status(httpError.status).json({ error: { message: httpError.message, code: httpError.code } })
}
