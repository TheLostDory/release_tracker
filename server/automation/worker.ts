import type { Config } from '../config.js'
import { decrypt } from '../crypto.js'
import type { Db } from '../db/pool.js'
import { cached } from '../integrations/cache.js'
import { githubBranchExists, type GitHubConnection } from '../integrations/github.js'
import { jenkinsBuildTree, jenkinsQueueItem, jenkinsTrigger, type JenkinsConnection } from '../integrations/jenkins.js'
import { jiraVersions, type JiraAuth, type JiraConnection } from '../integrations/jira.js'
import { OutboundError } from '../integrations/outbound.js'
import type { IntegrationRow } from '../integrations/store.js'
import { runComparison } from '../routes/code-compare.js'

/**
 * Background automation (no signed-in user; only through database functions
 * that do exactly one thing each). Each task runs at its own pace.
 */

interface StartRow {
  id: string
  release_id: string
  purpose: string
  job_path: string
  parameters: Record<string, string>
  state: 'to_start' | 'queued'
  queue_url: string | null
  attempts: number
  created_at: string
  base_url: string
  username: string | null
  secret_encrypted: string
  ca_cert: string | null
}

const MAX_START_ATTEMPTS = 3

/**
 * Starts requested Jenkins jobs, then finds the build each start became and
 * attaches it to the Automated jobs step (its status is read right away).
 */
export async function processJenkinsStarts(db: Db, config: Config, releaseId?: string): Promise<{ started: number; resolved: number; failed: number }> {
  const result = { started: 0, resolved: 0, failed: 0 }
  if (!config.ENCRYPTION_KEY) return result
  const { rows } = await db.query<StartRow>('select * from jenkins_starts_due()')
  for (const s of rows.filter((r) => !releaseId || r.release_id === releaseId)) {
    const conn: JenkinsConnection = { baseUrl: s.base_url, username: s.username, secret: decrypt(s.secret_encrypted, config.ENCRYPTION_KEY), ca: s.ca_cert }
    try {
      if (s.state === 'to_start') {
        const queueUrl = await jenkinsTrigger(conn, s.job_path, s.parameters)
        if (!queueUrl) {
          await fail(db, s, "Jenkins started the job but didn't say which queue item it became: paste the run's link instead.", true)
          result.failed++
          continue
        }
        await db.query("select jenkins_start_update($1, 'queued', $2, null)", [s.id, queueUrl])
        result.started++
        s.state = 'queued'
        s.queue_url = queueUrl
      }
      const q = await jenkinsQueueItem(conn, s.queue_url!)
      if (q.state === 'started') {
        const runId = (await db.query<{ id: string }>('select jenkins_start_resolved($1, $2) as id', [s.id, q.number])).rows[0]?.id
        if (runId) {
          const status = await jenkinsBuildTree(conn, { jobPath: s.job_path, build: q.number }).catch(() => null)
          if (status) await db.query('select jenkins_followed_record($1, $2, null)', [runId, JSON.stringify(status)])
        }
        result.resolved++
      } else if (q.state === 'cancelled') {
        await fail(db, s, 'The job was cancelled in Jenkins before it started.', true)
        result.failed++
      } else if (q.state === 'gone') {
        await fail(db, s, "Jenkins no longer knows this queue item: paste the run's link instead.", true)
        result.failed++
      }
      // waiting: check again next round.
    } catch (err) {
      const message = err instanceof OutboundError ? err.message : `Could not start: ${(err as Error).message}`
      await fail(db, s, message, s.attempts + 1 >= MAX_START_ATTEMPTS)
      result.failed++
    }
  }
  return result
}

async function fail(db: Db, s: StartRow, message: string, final: boolean) {
  console.warn(`[automation] ${s.job_path}: ${message}`)
  await db.query('select jenkins_start_update($1, $2, null, $3)', [s.id, final ? 'failed' : s.state, message])
}

interface CandidateRow {
  release_id: string
  project_id: string
  name: string
  version: string
  jira_version_id: string | null
  rc_open: boolean
  deploy_open: boolean
  rc_from_github: boolean
  deploy_from_jira: boolean
  code_refs: { repo: string; head: string }[]
  gh_base_url: string | null
  gh_secret: string | null
  gh_ca: string | null
  gh_settings: { repos?: string[]; headTemplate?: string } | null
  jira_integration_id: string | null
  jira_base_url: string | null
  jira_auth: JiraAuth | null
  jira_username: string | null
  jira_secret: string | null
  jira_ca: string | null
  jira_settings: { projectKey?: string } | null
}

const fill = (t: string, r: { name: string; version: string }) => t.replaceAll('{{version}}', r.version).replaceAll('{{name}}', r.name)

/**
 * RC creation completes when the RC branch exists on GitHub in every
 * repository; Deployment completes when the Jira version is released.
 */
export async function checkAutoComplete(db: Db, config: Config, projectId?: string): Promise<{ rc: number; deployed: number }> {
  const done = { rc: 0, deployed: 0 }
  if (!config.ENCRYPTION_KEY) return done
  const { rows } = await db.query<CandidateRow>('select * from auto_complete_candidates()')
  for (const r of rows.filter((x) => !projectId || x.project_id === projectId)) {
    // RC branch on GitHub.
    if (r.rc_open && r.rc_from_github && r.gh_base_url && r.gh_secret) {
      try {
        const gh: GitHubConnection = { apiUrl: r.gh_base_url, secret: decrypt(r.gh_secret, config.ENCRYPTION_KEY), ca: r.gh_ca }
        // The release's chosen branches (Code vs Jira), or the project's RC pattern in each repository.
        const wanted = r.code_refs.length
          ? r.code_refs.map((c) => ({ repo: c.repo, branch: c.head }))
          : (r.gh_settings?.repos ?? []).map((repo) => ({ repo, branch: fill(r.gh_settings?.headTemplate || 'release/{{version}}', r) }))
        if (wanted.length) {
          const found = await Promise.all(wanted.map((w) => githubBranchExists(gh, w.repo, w.branch)))
          if (found.every(Boolean)) {
            const where = [...new Set(wanted.map((w) => w.branch))].join(', ')
            const reason = `RC creation completed automatically: ${where} found on GitHub (${wanted.map((w) => w.repo).join(', ')})`
            if ((await db.query<{ ok: boolean }>("select complete_step_by_automation($1, 'RC_CREATION', $2) as ok", [r.release_id, reason])).rows[0]?.ok) done.rc++
          }
        }
      } catch (err) {
        console.warn(`[automation] RC check for ${r.name}: ${(err as Error).message}`)
      }
    }
    // Jira version released.
    if (r.deploy_open && r.deploy_from_jira && r.jira_version_id && r.jira_base_url && r.jira_secret && r.jira_settings?.projectKey) {
      try {
        const jira: JiraConnection = {
          baseUrl: r.jira_base_url,
          authType: r.jira_auth!,
          username: r.jira_username,
          secret: decrypt(r.jira_secret, config.ENCRYPTION_KEY),
          ca: r.jira_ca,
        }
        const versions = await cached(`versions:${r.jira_integration_id}`, 60_000, () => jiraVersions(jira, r.jira_settings!.projectKey!))
        const v = versions.find((x) => x.id === r.jira_version_id)
        if (v?.released) {
          const day = v.releaseDate ?? new Date().toISOString().slice(0, 10)
          const reason = `Deployment completed automatically: Jira version ${v.name} was released${v.releaseDate ? ` on ${v.releaseDate}` : ''}`
          if ((await db.query<{ ok: boolean }>('select mark_deployed_by_automation($1, $2, $3) as ok', [r.release_id, day, reason])).rows[0]?.ok) done.deployed++
        }
      } catch (err) {
        console.warn(`[automation] Jira check for ${r.name}: ${(err as Error).message}`)
      }
    }
  }
  return done
}

interface JiraTarget {
  project_id: string
  import_versions: boolean
  sync_dates: boolean
  integration_id: string
  base_url: string
  auth_type: JiraAuth
  username: string | null
  secret_encrypted: string
  ca_cert: string | null
  settings: { projectKey?: string }
}

const MAX_IMPORTS_PER_RUN = 20
/** Unreleased versions this far past their date are left alone (stale). */
const IMPORT_STALE_DAYS = 30

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return isoDay(d)
}

/** Releases follow their Jira versions; new unreleased versions become releases. */
export async function syncJira(db: Db, config: Config, projectId?: string, today = isoDay(new Date())): Promise<{ imported: number; updated: number }> {
  const result = { imported: 0, updated: 0 }
  if (!config.ENCRYPTION_KEY) return result
  const { rows } = await db.query<JiraTarget>('select * from jira_sync_targets()')
  for (const t of rows.filter((x) => !projectId || x.project_id === projectId)) {
    if (!t.settings.projectKey) continue
    try {
      const conn: JiraConnection = { baseUrl: t.base_url, authType: t.auth_type, username: t.username, secret: decrypt(t.secret_encrypted, config.ENCRYPTION_KEY), ca: t.ca_cert }
      const versions = await jiraVersions(conn, t.settings.projectKey!)
      const linked = (await db.query<{ id: string; jira_version_id: string }>('select id, jira_version_id from jira_sync_releases($1)', [t.project_id])).rows
      const byVersion = new Map(linked.map((r) => [r.jira_version_id, r.id]))

      if (t.sync_dates) {
        for (const v of versions) {
          const releaseId = byVersion.get(v.id)
          if (!releaseId) continue
          const changes = (await db.query<{ c: string[] }>('select jira_sync_release($1, $2, $3) as c', [releaseId, v.name, v.releaseDate])).rows[0]?.c ?? []
          if (changes.length) result.updated++
        }
      }
      if (t.import_versions) {
        const fresh = versions.filter(
          (v) => !v.released && !v.archived && !byVersion.has(v.id) && (!v.releaseDate || v.releaseDate >= addDays(today, -IMPORT_STALE_DAYS)),
        )
        for (const v of fresh.slice(0, MAX_IMPORTS_PER_RUN)) {
          const id = (await db.query<{ id: string | null }>('select jira_import_version($1, $2, $3, $4, $5) as id', [
            t.project_id,
            v.id,
            v.name,
            v.releaseDate ?? addDays(today, 14),
            v.description,
          ])).rows[0]?.id
          if (id) result.imported++
        }
      }
    } catch (err) {
      console.warn(`[automation] Jira sync for project ${t.project_id}: ${(err as Error).message}`)
    }
  }
  return result
}

interface CodeTarget {
  release_id: string
  project_id: string
  name: string
  version: string
  jira_version_id: string | null
  jira_version_name: string | null
  refs: { repo: string; base_ref: string; head_ref: string }[]
  gh_id: string
  gh_base_url: string
  gh_secret: string
  gh_ca: string | null
  gh_settings: IntegrationRow['settings']
  jira_id: string | null
  jira_base_url: string | null
  jira_auth: JiraAuth | null
  jira_username: string | null
  jira_secret: string | null
  jira_ca: string | null
  jira_settings: IntegrationRow['settings'] | null
}

/** Re-runs Code vs Jira for open releases (hourly per release); more differences → Teams. */
export async function runBackgroundCodeChecks(db: Db, config: Config, projectId?: string): Promise<{ checked: number; errors: string[] }> {
  const errors: string[] = []
  if (!config.ENCRYPTION_KEY) return { checked: 0, errors }
  const key = config.ENCRYPTION_KEY
  const { rows } = await db.query<CodeTarget>('select * from code_check_targets()')
  let checked = 0
  for (const t of rows.filter((x) => !projectId || x.project_id === projectId)) {
    const row = (kind: 'GITHUB' | 'JIRA', id: string, base: string, ca: string | null, settings: IntegrationRow['settings'], auth: IntegrationRow['auth_type'], username: string | null): IntegrationRow => ({
      id,
      project_id: t.project_id,
      kind,
      auth_type: auth,
      base_url: base,
      username,
      settings,
      last_error: null,
      last_checked_at: null,
      ca_cert: ca,
    })
    try {
      const gh = { row: row('GITHUB', t.gh_id, t.gh_base_url, t.gh_ca, t.gh_settings, 'GITHUB', null), secret: decrypt(t.gh_secret, key) }
      const jira =
        t.jira_id && t.jira_base_url && t.jira_secret
          ? { row: row('JIRA', t.jira_id, t.jira_base_url, t.jira_ca, t.jira_settings ?? {}, t.jira_auth!, t.jira_username), secret: decrypt(t.jira_secret, key) }
          : null
      const { summary } = await runComparison({ release: { id: t.release_id, name: t.name, version: t.version, jira_version_id: t.jira_version_id, jira_version_name: t.jira_version_name }, refs: t.refs, gh, jira, fresh: true, lookups: false })
      await db.query('select record_code_check($1, $2)', [t.release_id, JSON.stringify(summary)])
      checked++
    } catch (err) {
      const message = `Code vs Jira for ${t.name}: ${(err as Error).message}`
      console.warn(`[automation] ${message}`)
      errors.push(message)
    }
  }
  return { checked, errors }
}

/** Runs the automation tasks: Jenkins starts every 20 s; step checks every 5 minutes; Jira sync every 10; Code vs Jira every 15 (each release hourly). */
export function startAutomationWorker(db: Db, config: Config): () => void {
  let running = false
  let ticks = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      await processJenkinsStarts(db, config)
      if (ticks % 30 === 0) await syncJira(db, config)
      if (ticks % 15 === 0) await checkAutoComplete(db, config)
      if (ticks % 45 === 0) await runBackgroundCodeChecks(db, config)
      ticks++
    } catch (err) {
      console.error('[automation] failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), 20_000)
  void tick()
  return () => clearInterval(timer)
}
