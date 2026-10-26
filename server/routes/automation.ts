import { Router } from 'express'
import type { Config } from '../config.js'
import type { Db } from '../db/pool.js'
import { automationSchema, automationSettings } from '../automation/settings.js'
import { processTestAnalyses, readFailedTests } from '../automation/test-analysis.js'
import { framedReport } from '../automation/test-report.js'
import { processJenkinsStarts } from '../automation/worker.js'
import { jenkinsGetText } from '../integrations/jenkins.js'
import { asHttpError } from '../integrations/outbound.js'
import { jenkinsConnection, loadIntegration } from '../integrations/store.js'
import { z } from 'zod'
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

  // --- Failed tests of HIT / Load Test runs, and their Jira bugs -------------------------
  router.get('/releases/:id/test-analyses', async (req, res) => {
    const id = idParam(req)
    const rows = await asUser(db, req, async (tx) =>
      (await tx.query('select run_id, state, result, error, analyzed_at, requested_at from release_test_analyses where release_id = $1', [id])).rows,
    )
    res.json(rows)
  })

  /** "Check again": re-read the report and look the bugs up now. */
  router.post('/jenkins/followed/:fid/analyze', async (req, res) => {
    const fid = idParam(req, 'fid')
    // Optionally the report's link, when it can't be found by itself.
    const { reportUrl } = z.strictObject({ reportUrl: z.string().trim().url().max(2000).optional() }).parse(req.body ?? {})
    const releaseId = await asUser(db, req, async (tx) => {
      await tx.query('select request_test_analysis($1, $2)', [fid, reportUrl ?? null])
      return (await tx.query<{ release_id: string }>('select release_id from release_jenkins_builds where id = $1', [fid])).rows[0]?.release_id
    })
    if (releaseId) await processTestAnalyses(db, config, releaseId)
    res.status(202).json({ ok: true })
  })

  /** Settings → "Test on a report": which failed tests a pattern (or the built-in reading) finds. */
  router.post('/projects/:id/test-report/preview', async (req, res) => {
    const id = idParam(req)
    const body = z.strictObject({ reportUrl: z.string().url().max(2000), pattern: z.string().max(500).default('') }).parse(req.body)
    if (body.pattern) {
      try {
        new RegExp(body.pattern, 'gim')
      } catch {
        throw new HttpError(422, 'The pattern is not a valid regular expression.', 'invalid')
      }
    }
    const how: string[] = []
    const failedTests = await asUser(db, req, async (tx) => {
      const role = await tx.query<{ ok: boolean }>("select coalesce(project_role_of($1) >= 'ADMIN'::project_role, false) as ok", [id])
      if (!role.rows[0]?.ok) throw forbidden()
      const j = await loadIntegration(tx, config, id, 'JENKINS')
      const jenkins = jenkinsConnection(j.row, j.secret)
      // Same reading as the analysis: into HTML Publisher's frame, Gauge reports, the project pattern.
      let url = body.reportUrl
      let html = await jenkinsGetText(jenkins, url).catch(asHttpError)
      const frame = framedReport(html, url)
      if (frame && new URL(frame).host === new URL(url).host) {
        how.push(`The page shows the report in a frame: followed it to ${frame}.`)
        url = frame
        html = await jenkinsGetText(jenkins, url).catch(asHttpError)
      }
      return readFailedTests(jenkins, url, html, body.pattern || null, how).catch(asHttpError)
    })
    res.json({ failedTests, how })
  })

  return router
}
