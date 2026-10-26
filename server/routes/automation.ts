import { Router } from 'express'
import type { Db } from '../db/pool.js'
import { automationSchema, automationSettings } from '../automation/settings.js'
import { notFound } from '../http/errors.js'
import { asUser, explainNoRows, idParam } from '../http/helpers.js'

export function automationRoutes(db: Db) {
  const router = Router()

  router.get('/projects/:id/automation', async (req, res) => {
    const id = idParam(req)
    const row = await asUser(db, req, async (tx) => (await tx.query<{ automation: unknown }>('select automation from projects where id = $1', [id])).rows[0])
    if (!row) throw notFound('Project not found.')
    res.json(automationSettings(row.automation))
  })

  /** Admins and owners (the projects update policy). */
  router.put('/projects/:id/automation', async (req, res) => {
    const id = idParam(req)
    const settings = automationSchema.parse(req.body)
    await asUser(db, req, async (tx) => {
      const r = await tx.query('update projects set automation = $2 where id = $1', [id, JSON.stringify(settings)])
      if (!r.rowCount) await explainNoRows(tx, 'projects', id, 'Project')
    })
    res.status(204).end()
  })

  /** Re-plans every open step of a release from its target date (members). */
  router.post('/releases/:id/plan-dates', async (req, res) => {
    const id = idParam(req)
    const changed = await asUser(db, req, async (tx) => (await tx.query<{ n: number }>('select plan_release_dates($1) as n', [id])).rows[0]!.n)
    res.json({ changed })
  })

  return router
}
