import type { Config } from '../config.js'
import { decrypt } from '../crypto.js'
import type { Db } from '../db/pool.js'
import { jenkinsGetText, type JenkinsConnection } from '../integrations/jenkins.js'
import type { JiraAuth, JiraConnection } from '../integrations/jira.js'
import { OutboundError } from '../integrations/outbound.js'
import { automationSettings } from './settings.js'
import { findBugsForTests } from './test-failures.js'
import { extractFailedTests } from './test-report.js'

interface DueAnalysis {
  run_id: string
  release_id: string
  project_id: string
  purpose: string
  job_path: string
  build_number: number
  status: { reportUrl?: string | null; url?: string; result?: string | null } | null
  attempts: number
  automation: unknown
  jenkins_base_url: string
  jenkins_username: string | null
  jenkins_secret: string
  jenkins_ca: string | null
  jira_id: string | null
  jira_base_url: string | null
  jira_auth: JiraAuth | null
  jira_username: string | null
  jira_secret: string | null
  jira_ca: string | null
  jira_settings: { projectKey?: string } | null
}

/**
 * Finished HIT / Load Test runs: failed tests from the HTML report, then the
 * Jira bugs linked to each. Stored per run; retried a few times on errors.
 */
export async function processTestAnalyses(db: Db, config: Config, releaseId?: string): Promise<{ done: number; failed: number }> {
  const out = { done: 0, failed: 0 }
  if (!config.ENCRYPTION_KEY) return out
  const key = config.ENCRYPTION_KEY
  const { rows } = await db.query<DueAnalysis>('select * from test_analyses_due()')
  for (const a of rows.filter((r) => !releaseId || r.release_id === releaseId)) {
    const settings = automationSettings(a.automation).testFailures
    const reportUrl = a.status?.reportUrl ?? null
    try {
      if (!reportUrl) {
        await db.query("select test_analysis_save($1, 'failed', null, $2)", [a.run_id, 'This run has no HTML report (an .html artifact), so its failed tests can’t be read.'])
        out.failed++
        continue
      }
      const jenkins: JenkinsConnection = { baseUrl: a.jenkins_base_url, username: a.jenkins_username, secret: decrypt(a.jenkins_secret, key), ca: a.jenkins_ca }
      const html = await jenkinsGetText(jenkins, reportUrl)
      const failed = extractFailedTests(html, settings.failedPattern || null)
      const notes: string[] = []
      let tests = failed.map((name) => ({ name, bugs: [] as unknown[] }))
      if (failed.length && a.jira_base_url && a.jira_secret) {
        const jira: JiraConnection = {
          baseUrl: a.jira_base_url,
          authType: a.jira_auth!,
          username: a.jira_username,
          secret: decrypt(a.jira_secret, key),
          ca: a.jira_ca,
        }
        const found = await findBugsForTests(jira, { projectKey: a.jira_settings?.projectKey ?? null, bugTypes: settings.bugTypes, allProjects: settings.allProjects }, failed)
        tests = found.tests
        notes.push(...found.notes)
      } else if (failed.length) {
        notes.push('Jira is not connected, so bugs weren’t looked up.')
      }
      const result = { reportUrl, runResult: a.status?.result ?? null, failedTests: tests, notes }
      await db.query("select test_analysis_save($1, 'done', $2, null)", [a.run_id, JSON.stringify(result)])
      out.done++
    } catch (err) {
      const message = err instanceof OutboundError ? err.message : (err as Error).message
      console.warn(`[automation] test analysis for ${a.job_path} #${a.build_number}: ${message}`)
      await db.query('select test_analysis_save($1, $2, null, $3)', [a.run_id, a.attempts + 1 >= 3 ? 'failed' : 'pending', message])
      out.failed++
    }
  }
  return out
}
