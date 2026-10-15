import { createHash, randomBytes } from 'node:crypto'
import type { CookieOptions, Request, RequestHandler, Response } from 'express'
import type { Config } from '../config.js'
import type { Db } from '../db/pool.js'
import { HttpError } from '../http/errors.js'

export const SESSION_COOKIE = 'rt_session'

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

function cookieOptions(config: Config, req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE || req.secure,
    path: '/',
    maxAge: config.SESSION_DAYS * 24 * 3600 * 1000,
  }
}

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000)

export async function startSession(db: Db, config: Config, req: Request, res: Response, userId: string) {
  const token = randomBytes(32).toString('base64url')
  await db.query('select create_session($1, $2, $3)', [userId, hashToken(token), daysFromNow(config.SESSION_DAYS)])
  res.cookie(SESSION_COOKIE, token, cookieOptions(config, req))
}

export async function endSession(db: Db, config: Config, req: Request, res: Response) {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) await db.query('select delete_session($1)', [hashToken(token)])
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(config, req), maxAge: undefined })
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Signed-in user id, set by `authenticate`. */
    userId?: string
  }
}

/** Resolves the session cookie (sliding expiry). Never rejects by itself. */
export function authenticate(db: Db, config: Config): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, SESSION_COOKIE)
    if (token) {
      const { rows } = await db.query<{ uid: string | null }>('select resolve_session($1, $2) as uid', [
        hashToken(token),
        daysFromNow(config.SESSION_DAYS),
      ])
      if (rows[0]?.uid) req.userId = rows[0].uid
    }
    next()
  }
}

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.userId) return next(new HttpError(401, 'Sign in to continue.', 'unauthenticated'))
  next()
}

/** Typed access in handlers placed after `requireUser`. */
export function userId(req: Request): string {
  if (!req.userId) throw new HttpError(401, 'Sign in to continue.', 'unauthenticated')
  return req.userId
}
