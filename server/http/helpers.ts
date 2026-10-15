import type { Request } from 'express'
import { z } from 'zod'
import { userId } from '../auth/sessions.js'
import { withUser, type Db, type Tx } from '../db/pool.js'
import { forbidden, notFound } from './errors.js'

/** Runs `fn` as the signed-in user (RLS applies). */
export function asUser<T>(db: Db, req: Request, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withUser(db, userId(req), fn)
}

export const uuid = z.string().uuid()
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
export const idParam = (req: Request, name = 'id') => uuid.parse(req.params[name])

/**
 * After an UPDATE/DELETE that matched no row: tell "doesn't exist / not
 * visible" (404) from "visible but not allowed" (403). RLS hides rows the
 * user can't read, so a visible row means the write was refused.
 */
export async function explainNoRows(tx: Tx, table: string, id: string, what: string): Promise<never> {
  const { rowCount } = await tx.query(`select 1 from ${table} where id = $1`, [id])
  throw rowCount ? forbidden() : notFound(`${what} not found.`)
}

/** Builds "col = $n" assignments from a validated patch object. */
export function setClause(patch: Record<string, unknown>, startAt = 1) {
  const keys = Object.keys(patch)
  return {
    sql: keys.map((k, i) => `${k} = $${i + startAt}`).join(', '),
    values: keys.map((k) => patch[k]),
    empty: keys.length === 0,
  }
}
