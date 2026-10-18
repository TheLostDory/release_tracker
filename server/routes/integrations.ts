import { Router } from 'express'
import { z } from 'zod'
import type { Config } from '../config.js'
import { encrypt } from '../crypto.js'
import type { Db, Tx } from '../db/pool.js'
import { userId } from '../auth/sessions.js'
import { forbidden, HttpError, notFound } from '../http/errors.js'
import { asUser, idParam, uuid } from '../http/helpers.js'
import {
  applyTemplate,
  jenkinsBuilds,
  jenkinsBuildTree,
  jenkinsTrigger,
  jenkinsWhoAmI,
  normalizeJobPath,
  parseBuildUrl,
  resolveBuildNumber,
} from '../integrations/jenkins.js'
import { isJiraProjectKey, jiraProjectName, jiraVersionIssues, jiraVersions, jiraWhoAmI, type JiraVersion } from '../integrations/jira.js'
import { cached, uncache } from '../integrations/cache.js'
import { inspectCertificates } from '../integrations/certificate.js'
import { asHttpError, normalizeBaseUrl, normalizeCaCert, OutboundError } from '../integrations/outbound.js'
import { syncJenkins } from '../integrations/poller.js'
import {
  jenkinsConnection,
  jiraConnection,
  loadIntegration,
  PUBLIC_COLUMNS,
  requireKey,
  type IntegrationKind,
  type IntegrationRow,
} from '../integrations/store.js'

const kindParam = z.enum(['jira', 'jenkins']).transform((k) => k.toUpperCase() as IntegrationKind)

const saveBody = z.strictObject({
  authType: z.enum(['JIRA_CLOUD', 'JIRA_SERVER', 'JENKINS']),
  baseUrl: z.string().max(500),
  username: z.string().trim().max(200).nullable().optional(),
  /** Omit to keep the stored secret. */
  secret: z.string().min(1).max(2000).optional(),
  projectKey: z.string().trim().toUpperCase().optional(),
  /** Company CA certificate(s), PEM. Omit to keep; null or "" to remove. */
  caCert: z.string().max(65536).nullable().optional(),
})

const followBody = z.strictObject({
  url: z.string().trim().min(1).max(2000),
  label: z.string().trim().max(100).nullable().optional(),
})

const FOLLOWED_COLUMNS = 'id, release_id, job_path, build_number, label, status, last_synced_at, last_error, created_at'

const jobBody = z.strictObject({
  jobPath: z.string().min(1).max(500),
  purpose: z.enum(['AUTOMATED', 'LOAD_TEST', 'LONGEVITY', 'HIT', 'OTHER']),
  parameters: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/), z.string().max(500)).default({}),
})

async function releaseInfo(tx: Tx, releaseId: string) {
  const { rows } = await tx.query<{ id: string; project_id: string; name: string; version: string; jira_version_id: string | null }>(
    'select id, project_id, name, version, jira_version_id from releases where id = $1',
    [releaseId],
  )
  if (!rows[0]) throw notFound('Release not found.')
  return rows[0]
}

async function requireRole(tx: Tx, projectId: string, min: 'MEMBER' | 'ADMIN') {
  const { rows } = await tx.query<{ ok: boolean }>("select coalesce(project_role_of($1) >= $2::project_role, false) as ok", [projectId, min])
  if (!rows[0]?.ok) throw forbidden()
}

export function integrationRoutes(db: Db, config: Config) {
  const router = Router()

  // --- Connections (project settings) ---------------------------------------------
  router.get('/projects/:id/integrations', async (req, res) => {
    const rows = await asUser(db, req, async (tx) =>
      (await tx.query<IntegrationRow>(`select ${PUBLIC_COLUMNS} from integrations where project_id = $1 order by kind`, [idParam(req)])).rows,
    )
    res.json(rows)
  })

  // Tests the connection first, then saves (create or update). Admins only.
  router.put('/projects/:id/integrations/:kind', async (req, res) => {
    const projectId = idParam(req)
    const kind = kindParam.parse(req.params.kind)
    const body = saveBody.parse(req.body)
    const key = requireKey(config)
    const baseUrl = normalizeBaseUrl(body.baseUrl)
    if ((kind === 'JIRA') !== (body.authType !== 'JENKINS')) throw new HttpError(422, 'Auth type does not match the integration.', 'invalid')
    if (kind === 'JIRA' && (!body.projectKey || !isJiraProjectKey(body.projectKey))) {
      throw new HttpError(422, 'Enter the Jira project key, e.g. ABC.', 'invalid')
    }

    const result = await asUser(db, req, async (tx) => {
      await requireRole(tx, projectId, 'ADMIN')
      // Company certificate: keep the stored one unless given ("" / null removes it).
      let ca: string | null
      if (body.caCert === undefined) {
        const existing = await tx.query<{ ca_cert: string | null }>('select ca_cert from integrations where project_id = $1 and kind = $2', [projectId, kind])
        ca = existing.rows[0]?.ca_cert ?? null
      } else {
        ca = body.caCert && body.caCert.trim() ? normalizeCaCert(body.caCert) : null
      }
      // Keep the stored secret when none is supplied.
      let secret = body.secret
      if (!secret) {
        try {
          secret = (await loadIntegration(tx, config, projectId, kind)).secret
        } catch {
          throw new HttpError(422, 'Enter the API token.', 'invalid')
        }
      }
      const username = body.username || null
      let summary: string
      try {
        if (kind === 'JIRA') {
          const conn = { baseUrl, authType: body.authType as 'JIRA_CLOUD' | 'JIRA_SERVER', username, secret, ca }
          const who = await jiraWhoAmI(conn)
          const projectName = await jiraProjectName(conn, body.projectKey!)
          summary = `Connected as ${who} · project ${projectName} (${body.projectKey})`
        } else {
          const what = await jenkinsWhoAmI({ baseUrl, username, secret, ca })
          summary = `Connected to ${what} as ${username}`
        }
      } catch (err) {
        asHttpError(err)
      }
      const settings = kind === 'JIRA' ? { projectKey: body.projectKey } : {}
      const encrypted = encrypt(secret, key)
      // Update-or-insert without ON CONFLICT: its "excluded.secret_encrypted"
      // counts as reading the secret column, which the app login can't do.
      const updated = await tx.query(
        `update integrations set auth_type = $3, base_url = $4, username = $5, secret_encrypted = $6, settings = $7,
           ca_cert = $8, last_error = null, last_checked_at = now()
         where project_id = $1 and kind = $2`,
        [projectId, kind, body.authType, baseUrl, username, encrypted, settings, ca],
      )
      if (!updated.rowCount) {
        await tx.query(
          `insert into integrations (project_id, kind, auth_type, base_url, username, secret_encrypted, settings, created_by, ca_cert, last_checked_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
          [projectId, kind, body.authType, baseUrl, username, encrypted, settings, userId(req), ca],
        )
      }
      return summary
    })
    res.json({ ok: true, message: result })
  })

  /** The certificate chain a server presents (untrusted), so an admin can choose to trust its root. */
  router.post('/projects/:id/integrations/inspect-certificate', async (req, res) => {
    const projectId = idParam(req)
    const { baseUrl } = z.strictObject({ baseUrl: z.string().max(500) }).parse(req.body)
    await asUser(db, req, (tx) => requireRole(tx, projectId, 'ADMIN'))
    res.json(await inspectCertificates(normalizeBaseUrl(baseUrl)))
  })

  router.post('/projects/:id/integrations/:kind/test', async (req, res) => {
    const projectId = idParam(req)
    const kind = kindParam.parse(req.params.kind)
    const message = await asUser(db, req, async (tx) => {
      const { row, secret } = await loadIntegration(tx, config, projectId, kind)
      try {
        const text =
          kind === 'JIRA'
            ? `Connected as ${await jiraWhoAmI(jiraConnection(row, secret))}`
            : `Connected to ${await jenkinsWhoAmI(jenkinsConnection(row, secret))}`
        await tx.query('update integrations set last_error = null, last_checked_at = now() where id = $1', [row.id]).catch(() => {})
        return text
      } catch (err) {
        asHttpError(err)
      }
    })
    res.json({ ok: true, message })
  })

  router.delete('/projects/:id/integrations/:kind', async (req, res) => {
    const projectId = idParam(req)
    const kind = kindParam.parse(req.params.kind)
    await asUser(db, req, async (tx) => {
      await requireRole(tx, projectId, 'ADMIN')
      await tx.query('delete from integrations where project_id = $1 and kind = $2', [projectId, kind])
    })
    res.status(204).end()
  })

  // --- Jira ---------------------------------------------------------------------------
  /** Versions of the connected Jira project, with any releases already linked. */
  router.get('/projects/:id/jira/versions', async (req, res) => {
    const projectId = idParam(req)
    const data = await asUser(db, req, async (tx) => {
      const { row, secret } = await loadIntegration(tx, config, projectId, 'JIRA')
      const versions = await cached(`versions:${row.id}`, 60_000, () =>
        jiraVersions(jiraConnection(row, secret), row.settings.projectKey!).catch(asHttpError),
      )
      const linked = await tx.query<{ id: string; name: string; jira_version_id: string }>(
        'select id, name, jira_version_id from releases where project_id = $1 and jira_version_id is not null',
        [projectId],
      )
      const byVersion = new Map(linked.rows.map((r) => [r.jira_version_id, { id: r.id, name: r.name }]))
      return versions.map((v) => ({ ...v, release: byVersion.get(v.id) ?? null }))
    })
    res.json(data)
  })

  /** Creates releases from Jira versions (skips versions already linked). */
  router.post('/projects/:id/jira/import', async (req, res) => {
    const projectId = idParam(req)
    const body = z
      .strictObject({ versionIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(50), sprintId: uuid.nullable().default(null) })
      .parse(req.body)
    const created = await asUser(db, req, async (tx) => {
      await requireRole(tx, projectId, 'MEMBER')
      const { row, secret } = await loadIntegration(tx, config, projectId, 'JIRA')
      const versions = await jiraVersions(jiraConnection(row, secret), row.settings.projectKey!).catch(asHttpError)
      uncache(`versions:${row.id}`)
      const byId = new Map<string, JiraVersion>(versions.map((v) => [v.id, v]))
      const ids: string[] = []
      for (const versionId of body.versionIds) {
        const v = byId.get(versionId)
        if (!v) throw new HttpError(404, `Jira version ${versionId} not found in ${row.settings.projectKey}.`, 'not_found')
        const exists = await tx.query('select 1 from releases where project_id = $1 and jira_version_id = $2', [projectId, versionId])
        if (exists.rowCount) continue
        const target = v.releaseDate ?? new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
        const r = await tx.query<{ id: string }>(
          `insert into releases (project_id, sprint_id, name, version, planned_deployment_date, description, owner_id,
                                 jira_version_id, jira_version_name)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $3) returning id`,
          [projectId, body.sprintId, v.name.slice(0, 100), v.name.slice(0, 50), target, v.description?.slice(0, 10_000) ?? null, userId(req), versionId],
        )
        ids.push(r.rows[0]!.id)
      }
      return ids
    })
    res.status(201).json({ created })
  })

  router.put('/releases/:id/jira', async (req, res) => {
    const releaseId = idParam(req)
    const { versionId } = z.strictObject({ versionId: z.string().regex(/^\d{1,20}$/).nullable() }).parse(req.body)
    await asUser(db, req, async (tx) => {
      const release = await releaseInfo(tx, releaseId)
      await requireRole(tx, release.project_id, 'MEMBER')
      let name: string | null = null
      if (versionId) {
        const { row, secret } = await loadIntegration(tx, config, release.project_id, 'JIRA')
        const versions = await jiraVersions(jiraConnection(row, secret), row.settings.projectKey!).catch(asHttpError)
        const v = versions.find((x) => x.id === versionId)
        if (!v) throw new HttpError(404, 'That Jira version no longer exists.', 'not_found')
        name = v.name
      }
      await tx.query('update releases set jira_version_id = $2, jira_version_name = $3 where id = $1', [releaseId, versionId, name])
    })
    res.status(204).end()
  })

  /** Issues (tasks, bugs, stories…) in the release's Jira version. */
  router.get('/releases/:id/jira/issues', async (req, res) => {
    const releaseId = idParam(req)
    const fresh = req.query.refresh === 'true'
    const data = await asUser(db, req, async (tx) => {
      const release = await releaseInfo(tx, releaseId)
      if (!release.jira_version_id) return { linked: false as const }
      const { row, secret } = await loadIntegration(tx, config, release.project_id, 'JIRA')
      const key = `issues:${row.id}:${release.jira_version_id}`
      if (fresh) uncache(key)
      const result = await cached(key, 60_000, () =>
        jiraVersionIssues(jiraConnection(row, secret), release.jira_version_id!).catch(asHttpError),
      )
      return { linked: true as const, versionUrl: `${row.base_url}/projects/${row.settings.projectKey}/versions/${release.jira_version_id}`, ...result }
    })
    res.json(data)
  })

  // --- Jenkins ------------------------------------------------------------------------
  router.get('/releases/:id/jenkins', async (req, res) => {
    const releaseId = idParam(req)
    const rows = await asUser(db, req, async (tx) => {
      await releaseInfo(tx, releaseId)
      const r = await tx.query(
        `select id, job_path, purpose, parameters, last_build, last_synced_at, last_error, created_at
         from release_jenkins_jobs where release_id = $1 order by purpose, job_path`,
        [releaseId],
      )
      return r.rows
    })
    res.json(rows)
  })

  router.post('/releases/:id/jenkins', async (req, res) => {
    const releaseId = idParam(req)
    const body = jobBody.parse(req.body)
    const job = await asUser(db, req, async (tx) => {
      const release = await releaseInfo(tx, releaseId)
      await requireRole(tx, release.project_id, 'MEMBER')
      const { row, secret } = await loadIntegration(tx, config, release.project_id, 'JENKINS')
      const jobPath = normalizeJobPath(body.jobPath, row.base_url)
      // Fails early (404) if the job doesn't exist.
      await jenkinsBuilds(jenkinsConnection(row, secret), jobPath, 1).catch(asHttpError)
      const r = await tx.query<{ id: string }>(
        `insert into release_jenkins_jobs (release_id, job_path, purpose, parameters, created_by) values ($1, $2, $3, $4, $5) returning id`,
        [releaseId, jobPath, body.purpose, body.parameters, userId(req)],
      )
      return r.rows[0]!
    })
    // Pick up the latest build right away.
    await syncJenkins(db, config, releaseId).catch(() => {})
    res.status(201).json(job)
  })

  router.delete('/jenkins/jobs/:jobId', async (req, res) => {
    const jobId = idParam(req, 'jobId')
    await asUser(db, req, async (tx) => {
      const r = await tx.query('delete from release_jenkins_jobs where id = $1', [jobId])
      if (!r.rowCount) {
        const visible = await tx.query('select 1 from release_jenkins_jobs where id = $1', [jobId])
        throw visible.rowCount ? forbidden() : notFound('Job not found.')
      }
    })
    res.status(204).end()
  })

  /** Recent builds of one linked job (live from Jenkins). */
  router.get('/jenkins/jobs/:jobId/builds', async (req, res) => {
    const jobId = idParam(req, 'jobId')
    const builds = await asUser(db, req, async (tx) => {
      const job = await tx.query<{ job_path: string; release_id: string }>('select job_path, release_id from release_jenkins_jobs where id = $1', [jobId])
      if (!job.rows[0]) throw notFound('Job not found.')
      const release = await releaseInfo(tx, job.rows[0].release_id)
      const { row, secret } = await loadIntegration(tx, config, release.project_id, 'JENKINS')
      return jenkinsBuilds(jenkinsConnection(row, secret), job.rows[0].job_path, 10).catch(asHttpError)
    })
    res.json(builds)
  })

  router.post('/jenkins/jobs/:jobId/run', async (req, res) => {
    const jobId = idParam(req, 'jobId')
    const releaseId = await asUser(db, req, async (tx) => {
      const job = await tx.query<{ job_path: string; release_id: string; parameters: Record<string, string> }>(
        'select job_path, release_id, parameters from release_jenkins_jobs where id = $1',
        [jobId],
      )
      if (!job.rows[0]) throw notFound('Job not found.')
      const release = await releaseInfo(tx, job.rows[0].release_id)
      await requireRole(tx, release.project_id, 'MEMBER')
      const { row, secret } = await loadIntegration(tx, config, release.project_id, 'JENKINS')
      await jenkinsTrigger(jenkinsConnection(row, secret), job.rows[0].job_path, applyTemplate(job.rows[0].parameters, release)).catch(asHttpError)
      await tx.query(
        `insert into activity_log (release_id, user_id, action, description, metadata)
         select $1, $2, 'jenkins.triggered', format('started Jenkins job %s', $3::text), jsonb_build_object('job_id', $4::text)`,
        [release.id, userId(req), job.rows[0].job_path, jobId],
      )
      return release.id
    })
    // Builds sit in Jenkins' queue briefly; check again shortly.
    setTimeout(() => void syncJenkins(db, config, releaseId).catch(() => {}), 10_000)
    res.status(202).json({ queued: true })
  })

  // --- Followed builds: a pasted build link and everything it started -----------------
  router.get('/releases/:id/jenkins/followed', async (req, res) => {
    const releaseId = idParam(req)
    const rows = await asUser(db, req, async (tx) => {
      await releaseInfo(tx, releaseId)
      return (await tx.query(`select ${FOLLOWED_COLUMNS} from release_jenkins_builds where release_id = $1 order by created_at`, [releaseId])).rows
    })
    res.json(rows)
  })

  router.post('/releases/:id/jenkins/followed', async (req, res) => {
    const releaseId = idParam(req)
    const body = followBody.parse(req.body)
    const row = await asUser(db, req, async (tx) => {
      const release = await releaseInfo(tx, releaseId)
      await requireRole(tx, release.project_id, 'MEMBER')
      const { row: jenkins, secret } = await loadIntegration(tx, config, release.project_id, 'JENKINS')
      const conn = jenkinsConnection(jenkins, secret)
      const ref = parseBuildUrl(body.url, jenkins.base_url)
      // A job link (or "lastBuild") means its latest run: follow that run.
      const number = await resolveBuildNumber(conn, ref).catch(asHttpError)
      const status = await jenkinsBuildTree(conn, { jobPath: ref.jobPath, build: number }).catch(asHttpError)
      const r = await tx.query(
        `insert into release_jenkins_builds (release_id, job_path, build_number, label, status, last_synced_at, created_by)
         values ($1, $2, $3, $4, $5, now(), $6) returning ${FOLLOWED_COLUMNS}`,
        [releaseId, ref.jobPath, number, body.label || null, JSON.stringify(status), userId(req)],
      )
      return r.rows[0]
    })
    res.status(201).json(row)
  })

  /** Live status from Jenkins (stored as the last known status). Anyone who can see the release. */
  router.post('/jenkins/followed/:fid/refresh', async (req, res) => {
    const fid = idParam(req, 'fid')
    const row = await asUser(db, req, async (tx) => {
      const found = await tx.query<{ release_id: string; job_path: string; build_number: number }>(
        'select release_id, job_path, build_number from release_jenkins_builds where id = $1',
        [fid],
      )
      const followed = found.rows[0]
      if (!followed) throw notFound('Followed build not found.')
      const release = await releaseInfo(tx, followed.release_id)
      const { row: jenkins, secret } = await loadIntegration(tx, config, release.project_id, 'JENKINS')
      try {
        // Several people may watch the same build: ask Jenkins at most every 10 s.
        const status = await cached(`followed:${fid}`, 10_000, () =>
          jenkinsBuildTree(jenkinsConnection(jenkins, secret), { jobPath: followed.job_path, build: followed.build_number }),
        )
        await tx.query('select jenkins_followed_record($1, $2, null)', [fid, JSON.stringify(status)])
      } catch (err) {
        if (!(err instanceof OutboundError)) throw err
        // Keep the last known status; show why it couldn't be refreshed.
        await tx.query('select jenkins_followed_record($1, null, $2)', [fid, err.message])
      }
      return (await tx.query(`select ${FOLLOWED_COLUMNS} from release_jenkins_builds where id = $1`, [fid])).rows[0]
    })
    res.json(row)
  })

  router.delete('/jenkins/followed/:fid', async (req, res) => {
    const fid = idParam(req, 'fid')
    await asUser(db, req, async (tx) => {
      const r = await tx.query('delete from release_jenkins_builds where id = $1', [fid])
      if (!r.rowCount) {
        const visible = await tx.query('select 1 from release_jenkins_builds where id = $1', [fid])
        throw visible.rowCount ? forbidden() : notFound('Followed build not found.')
      }
    })
    res.status(204).end()
  })

  router.post('/releases/:id/jenkins/sync', async (req, res) => {
    const releaseId = idParam(req)
    await asUser(db, req, async (tx) => {
      const release = await releaseInfo(tx, releaseId)
      await requireRole(tx, release.project_id, 'MEMBER')
    })
    const result = await syncJenkins(db, config, releaseId)
    res.json(result)
  })

  return router
}
