import type { Config } from '../config.js'
import { decrypt } from '../crypto.js'
import type { Db } from '../db/pool.js'
import { jenkinsBuilds } from './jenkins.js'
import { OutboundError } from './outbound.js'

interface SyncJob {
  job_id: string
  release_id: string
  job_path: string
  integration_id: string
  base_url: string
  username: string | null
  secret_encrypted: string
  ca_cert: string | null
}

/**
 * Fetches each job's latest build and records it (which may complete/block
 * the "Automated jobs" step or fill a report URL). Used by the background
 * poller and by "Sync now". `releaseId` limits it to one release.
 */
export async function syncJenkins(db: Db, config: Config, releaseId?: string): Promise<{ synced: number; failed: number }> {
  if (!config.ENCRYPTION_KEY) return { synced: 0, failed: 0 }
  const { rows } = await db.query<SyncJob>('select * from jenkins_jobs_to_sync()')
  const jobs = releaseId ? rows.filter((j) => j.release_id === releaseId) : rows
  let synced = 0
  let failed = 0
  const secrets = new Map<string, string>()

  // A few at a time: be gentle with Jenkins.
  const queue = [...jobs]
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        let secret = secrets.get(job.integration_id)
        if (!secret) {
          secret = decrypt(job.secret_encrypted, config.ENCRYPTION_KEY!)
          secrets.set(job.integration_id, secret)
        }
        const [latest] = await jenkinsBuilds({ baseUrl: job.base_url, username: job.username, secret, ca: job.ca_cert }, job.job_path, 1)
        await db.query('select jenkins_record_build($1, $2, null)', [job.job_id, latest ? JSON.stringify(latest) : null])
        synced++
      } catch (err) {
        const message = err instanceof OutboundError ? err.message : 'Sync failed.'
        await db.query('select jenkins_record_build($1, null, $2)', [job.job_id, message]).catch(() => {})
        failed++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker))
  return { synced, failed }
}

/** Background polling for releases that aren't deployed yet. */
export function startJenkinsPoller(db: Db, config: Config, intervalMs = 120_000): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await syncJenkins(db, config)
    } catch (err) {
      console.error('[jenkins] poll failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  void tick()
  return () => clearInterval(timer)
}
