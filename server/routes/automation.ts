import { Router } from 'express'
import type { Config } from '../config.js'
import type { Db } from '../db/pool.js'
import { automationSchema, automationSettings } from '../automation/settings.js'
import { processJenkinsStarts } from '../automation/worker.js'
import { forbidden, HttpError, notFound } from '../http/errors.js'
import { asUser, explainNoRows, idParam } from '../http/helpers.js'

export function automationRoutes(db: Db, config: Config) {
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

  // --- Start the project's automated Jenkins jobs for a release ------------------------
  router.get('/releases/:id/jenkins/starts', async (req, res) => {
    const id = idParam(req)
    const rows = await asUser(db, req, async (tx) =>
      (await tx.query(
        `select id, purpose::text, job_path, parameters, state, last_error, created_at
         from release_jenkins_starts where release_id = $1 order by created_at`,
        [id],
      )).rows,
    )
    res.json(rows)
  })

  router.post('/releases/:id/jenkins/start', async (req, res) => {
    const id = idParam(req)
    const queued = await asUser(db, req, async (tx) => {
      const jobs = await tx.query<{ n: number }>(
        `select coalesce(jsonb_array_length(p.automation -> 'jenkins' -> 'jobs'), 0) as n
         from releases r join projects p on p.id = r.project_id where r.id = $1`,
        [id],
      )
      if (!jobs.rows[0]) throw notFound('Release not found.')
      if (jobs.rows[0].n === 0) throw new HttpError(409, 'No Jenkins jobs are set up yet: add them in Settings → Project → Automation.', 'not_configured')
      return (await tx.query<{ n: number }>('select request_jenkins_starts($1) as n', [id])).rows[0]!.n
    })
    // Start them now rather than at the next background round.
    const progress = await processJenkinsStarts(db, config, id)
    res.status(202).json({ queued, ...progress })
  })

  router.delete('/jenkins/starts/:startId', async (req, res) => {
    const startId = idParam(req, 'startId')
    await asUser(db, req, async (tx) => {
      const r = await tx.query('delete from release_jenkins_starts where id = $1', [startId])
      if (!r.rowCount) {
        const visible = await tx.query('select 1 from release_jenkins_starts where id = $1', [startId])
        throw visible.rowCount ? forbidden() : notFound('Start not found.')
      }
    })
    res.status(204).end()
  })

  return router
}
