import type { Config } from '../config.js'
import { decrypt } from '../crypto.js'
import type { Db } from '../db/pool.js'
import { jenkinsBuildTree, jenkinsQueueItem, jenkinsTrigger, type JenkinsConnection } from '../integrations/jenkins.js'
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

/** Runs the automation tasks: Jenkins starts every 20 s. */
export function startAutomationWorker(db: Db, config: Config): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await processJenkinsStarts(db, config)
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
