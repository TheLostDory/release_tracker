import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import type { Config } from '../config.js'
import { withUser, type Db } from '../db/pool.js'
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password.js'
import { endSession, requireUser, startSession, userId } from '../auth/sessions.js'
import { HttpError } from '../http/errors.js'

const email = z.string().trim().toLowerCase().email().max(254)

const signupBody = z.strictObject({
  email,
  password: z.string().max(200),
  name: z.string().trim().min(1).max(80),
})
const loginBody = z.strictObject({ email, password: z.string().max(200) })

const PUBLIC_USER = 'id, email, name, avatar_url'

export function authRoutes(db: Db, config: Config) {
  const router = Router()
  // Brute-force protection on credential endpoints.
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })

  router.post('/signup', limiter, async (req, res) => {
    if (!config.SIGNUP_ENABLED) throw new HttpError(403, 'Sign-up is turned off. Ask an admin for an account.', 'signup_disabled')
    const body = signupBody.parse(req.body)
    const problem = passwordProblem(body.password)
    if (problem) throw new HttpError(422, problem, 'weak_password')
    const hash = await hashPassword(body.password)
    const { rows } = await db.query<{ id: string }>('select create_user($1, $2, $3) as id', [body.email, body.name, hash])
    const id = rows[0]!.id
    await startSession(db, config, req, res, id)
    const user = await withUser(db, id, (tx) => tx.query(`select ${PUBLIC_USER} from users where id = $1`, [id]))
    res.status(201).json({ user: user.rows[0] })
  })

  router.post('/login', limiter, async (req, res) => {
    const body = loginBody.parse(req.body)
    const { rows } = await db.query<{ id: string; password_hash: string }>('select * from login_lookup($1)', [body.email])
    const row = rows[0]
    // Hash even for unknown emails, so response time doesn't reveal which accounts exist.
    const matches = await verifyPassword(body.password, row?.password_hash ?? DUMMY_HASH)
    if (!row || !matches) throw new HttpError(401, 'Wrong email or password.', 'invalid_credentials')
    await startSession(db, config, req, res, row.id)
    const user = await withUser(db, row.id, (tx) => tx.query(`select ${PUBLIC_USER} from users where id = $1`, [row.id]))
    res.json({ user: user.rows[0] })
  })

  router.post('/logout', async (req, res) => {
    await endSession(db, config, req, res)
    res.status(204).end()
  })

  router.get('/me', requireUser, async (req, res) => {
    const id = userId(req)
    const { rows } = await withUser(db, id, (tx) => tx.query(`select ${PUBLIC_USER} from users where id = $1`, [id]))
    if (!rows[0]) throw new HttpError(401, 'Sign in to continue.', 'unauthenticated')
    res.json({ user: rows[0], signupEnabled: config.SIGNUP_ENABLED })
  })

  router.get('/config', (_req, res) => {
    res.json({ signupEnabled: config.SIGNUP_ENABLED })
  })

  return router
}

// A valid hash of a random password, used to equalise login timing.
const DUMMY_HASH = await hashPassword(crypto.randomUUID())
