import { Router } from 'express'
import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { userId } from '../auth/sessions.js'
import { HttpError, notFound } from '../http/errors.js'
import { asUser, explainNoRows, idParam, setClause, uuid } from '../http/helpers.js'

const STEPS = [
  'RELEASE_IDENTIFIED', 'RC_CREATION', 'AUTOMATED_JOBS', 'LOAD_TEST_REVIEW', 'LONGEVITY_REVIEW', 'HIT_REVIEW',
  'RC_EMAIL', 'RTP_CREATION', 'RC_ESCALATION_EMAIL', 'APPROVAL', 'RELEASE_EMAIL', 'DEPLOYMENT',
] as const
const role = z.enum(['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'])

const createBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
  sprintsEnabled: z.boolean().default(true),
})
const patchBody = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  sprints_enabled: z.boolean().optional(),
  enabled_steps: z.array(z.enum(STEPS)).max(12).optional(),
})

export function projectRoutes(db: Db) {
  const router = Router()

  // Projects the user belongs to, with their role.
  router.get('/projects', async (req, res) => {
    const rows = await asUser(db, req, async (tx) => {
      const r = await tx.query(
        `select p.id, p.name, p.description, p.sprints_enabled, p.enabled_steps, m.role
         from projects p join project_members m on m.project_id = p.id and m.user_id = $1
         order by p.name`,
        [userId(req)],
      )
      return r.rows
    })
    res.json(rows)
  })

  router.post('/projects', async (req, res) => {
    const body = createBody.parse(req.body)
    const id = await asUser(db, req, async (tx) => {
      const r = await tx.query<{ id: string }>('select create_project($1, $2, $3) as id', [
        body.name,
        body.description ?? '',
        body.sprintsEnabled,
      ])
      return r.rows[0]!.id
    })
    res.status(201).json({ id })
  })

  router.patch('/projects/:id', async (req, res) => {
    const id = idParam(req)
    const patch = patchBody.parse(req.body)
    const set = setClause(patch, 2)
    if (set.empty) return res.status(204).end()
    await asUser(db, req, async (tx) => {
      const r = await tx.query(`update projects set ${set.sql} where id = $1`, [id, ...set.values])
      if (!r.rowCount) await explainNoRows(tx, 'projects', id, 'Project')
    })
    res.status(204).end()
  })

  router.delete('/projects/:id', async (req, res) => {
    const id = idParam(req)
    await asUser(db, req, async (tx) => {
      const r = await tx.query('delete from projects where id = $1', [id])
      if (!r.rowCount) await explainNoRows(tx, 'projects', id, 'Project')
    })
    res.status(204).end()
  })

  // --- Members ---------------------------------------------------------------
  router.get('/projects/:id/members', async (req, res) => {
    const id = idParam(req)
    const rows = await asUser(db, req, async (tx) => {
      const r = await tx.query(
        `select m.user_id, m.role, m.created_at,
                json_build_object('id', u.id, 'name', u.name, 'email', u.email) as profile
         from project_members m join users u on u.id = m.user_id
         where m.project_id = $1 order by m.created_at`,
        [id],
      )
      return r.rows
    })
    res.json(rows)
  })

  router.put('/projects/:id/members/:userId', async (req, res) => {
    const { role: newRole } = z.strictObject({ role }).parse(req.body)
    await asUser(db, req, (tx) => tx.query('select set_member_role($1, $2, $3)', [idParam(req), idParam(req, 'userId'), newRole]))
    res.status(204).end()
  })

  router.delete('/projects/:id/members/:userId', async (req, res) => {
    await asUser(db, req, (tx) => tx.query('select remove_member($1, $2)', [idParam(req), idParam(req, 'userId')]))
    res.status(204).end()
  })

  // --- Invitations -----------------------------------------------------------
  router.get('/projects/:id/invitations', async (req, res) => {
    const id = idParam(req)
    const rows = await asUser(db, req, async (tx) => {
      const r = await tx.query(
        `select id, role, email, created_at, expires_at, use_count
         from project_invitations
         where project_id = $1 and revoked_at is null and accepted_at is null
         order by created_at desc`,
        [id],
      )
      return r.rows
    })
    res.json(rows)
  })

  router.post('/projects/:id/invitations/email', async (req, res) => {
    const body = z.strictObject({ email: z.string().trim().max(254), role }).parse(req.body)
    const result = await asUser(db, req, async (tx) => {
      const r = await tx.query<{ result: string }>('select invite_by_email($1, $2, $3) as result', [idParam(req), body.email, body.role])
      return r.rows[0]!.result
    })
    res.status(201).json({ result })
  })

  router.post('/projects/:id/invitations/link', async (req, res) => {
    const body = z.strictObject({ role, days: z.number().int().min(1).max(90) }).parse(req.body)
    const token = await asUser(db, req, async (tx) => {
      const r = await tx.query<{ token: string }>('select create_invite_link($1, $2, $3) as token', [idParam(req), body.role, body.days])
      return r.rows[0]!.token
    })
    // The only time the raw token exists outside the requester's browser.
    res.status(201).json({ token })
  })

  router.delete('/invitations/:id', async (req, res) => {
    await asUser(db, req, (tx) => tx.query('select revoke_invitation($1)', [idParam(req)]))
    res.status(204).end()
  })

  const token = z.string().min(10).max(200)

  router.get('/invites/:token', async (req, res) => {
    const t = token.parse(req.params.token)
    const info = await asUser(db, req, async (tx) => (await tx.query('select * from invite_link_info($1)', [t])).rows[0])
    if (!info) throw notFound('This invite link is invalid or has expired.')
    res.json(info)
  })

  router.post('/invites/:token/accept', async (req, res) => {
    const t = token.parse(req.params.token)
    const projectId = await asUser(db, req, async (tx) => {
      const r = await tx.query<{ id: string }>('select accept_invite_link($1) as id', [t])
      return r.rows[0]!.id
    })
    res.json({ projectId })
  })

  // --- People ------------------------------------------------------------------
  // Everyone sharing a project with the caller (for names in the UI).
  router.get('/users', async (req, res) => {
    const rows = await asUser(db, req, async (tx) => (await tx.query('select id, name from users order by name')).rows)
    res.json(rows)
  })

  router.patch('/me', async (req, res) => {
    const body = z.strictObject({ name: z.string().trim().min(1).max(80) }).parse(req.body)
    await asUser(db, req, async (tx) => {
      const r = await tx.query('update users set name = $2 where id = $1', [userId(req), body.name])
      if (!r.rowCount) throw new HttpError(404, 'Account not found.', 'not_found')
    })
    res.status(204).end()
  })

  return router
}

export { uuid }
