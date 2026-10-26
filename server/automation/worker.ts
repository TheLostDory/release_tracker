import type { Config } from '../config.js'
import { decrypt } from '../crypto.js'
import type { Db } from '../db/pool.js'
import { cached } from '../integrations/cache.js'
import { githubBranchExists, type GitHubConnection } from '../integrations/github.js'
import { jenkinsBuildTree, jenkinsQueueItem, jenkinsTrigger, type JenkinsConnection } from '../integrations/jenkins.js'
import { jiraVersions, type JiraAuth, type JiraConnection } from '../integrations/jira.js'
import { OutboundError } from '../integrations/outbound.js'

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

/** Runs the automation tasks: Jenkins starts every 20 s; step checks every 5 minutes. */
export function startAutomationWorker(db: Db, config: Config): () => void {
  let running = false
  let ticks = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      await processJenkinsStarts(db, config)
      if (ticks % 15 === 0) await checkAutoComplete(db, config)
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
