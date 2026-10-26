import type { Config } from '../config.js'
import { decrypt } from '../crypto.js'
import type { Db } from '../db/pool.js'
import { jenkinsGetText, reportGetPage, reportGetText, type JenkinsConnection } from '../integrations/jenkins.js'
import type { JiraAuth, JiraConnection } from '../integrations/jira.js'
import { OutboundError } from '../integrations/outbound.js'
import { automationSettings } from './settings.js'
import { findBugsForTests } from './test-failures.js'
import { failedFromGaugeResult, failedFromScript, failedScenariosOnSpecPage, failedSpecs, inlineScripts, isGaugeReport, scriptSources, specCounts } from './gauge.js'
import { extractFailedTests, framedReport, reportLinksFromBuildPage, textOf } from './test-report.js'

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
  /** A report link pasted for this run. */
  report_url: string | null
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

const MAX_SPEC_PAGES = 30

/**
 * Failed test names in a report page. A project pattern wins; Gauge reports
 * are read from their result data, else from the failed specs' pages; any
 * other report with the common layouts.
 */
export async function readFailedTests(jenkins: JenkinsConnection, url: string, html: string, pattern: string | null, how: string[] = []): Promise<string[]> {
  const title = textOf(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const visible = textOf(html.replace(/<title\b[\s\S]*?<\/title>/i, '')).slice(0, 160)
  how.push(`Read ${url}${title ? ` ("${title}")` : ''}, ${Math.round(html.length / 1024)} KB. Text starts: "${visible || '(no visible text)'}"`)
  if (pattern) {
    const found = extractFailedTests(html, pattern)
    how.push(`Used the project pattern: ${found.length} match${found.length === 1 ? '' : 'es'}.`)
    return found
  }
  // A page that draws the report in the browser: its data is in a script (inline or loaded).
  const inline = failedFromScript(inlineScripts(html).join('\n'))
  if (inline) {
    how.push(`Found Gauge's result data inside the page: ${inline.length} failed scenario${inline.length === 1 ? '' : 's'}.`)
    return inline
  }
  const scripts = scriptSources(html, url)
  how.push(scripts.length ? `The page loads ${scripts.length} script file${scripts.length === 1 ? '' : 's'}: ${scripts.map((x) => x.split('/').slice(-2).join('/')).join(', ')}.` : 'The page loads no script files from its own address.')
  for (const script of scripts.slice(0, 10)) {
    const text = await reportGetText(jenkins, script).catch(() => '')
    const found = text ? failedFromScript(text) : null
    if (found) {
      how.push(`Found Gauge's result data in ${script.split('/').slice(-2).join('/')}: ${found.length} failed scenario${found.length === 1 ? '' : 's'}.`)
      return found
    }
  }
  if (scripts.length) how.push('None of those scripts holds Gauge result data.')
  if (isGaugeReport(html) || /\/HTML_20Report\//i.test(url)) {
    how.push('Recognised a Gauge report.')
    for (const data of ['js/result.js', '../json-report/result.json']) {
      try {
        const found = failedFromGaugeResult(await reportGetText(jenkins, new URL(data, url).toString()))
        if (found) {
          how.push(`Read Gauge's result data (${data}): ${found.length} failed scenario${found.length === 1 ? '' : 's'}.`)
          return found
        }
        how.push(`${data} is there but isn't Gauge result data.`)
      } catch {
        how.push(`No ${data} next to the report.`)
      }
    }
    const counts = specCounts(html, url)
    how.push(`The overview links ${counts.specs} spec page${counts.specs === 1 ? '' : 's'}, ${counts.failed} marked failed.`)
    const specs = failedSpecs(html, url).slice(0, MAX_SPEC_PAGES)
    if (specs.length) {
      const names: string[] = []
      for (const spec of specs) {
        let reason = ''
        const got = await reportGetPage(jenkins, spec.url).catch((err: unknown) => {
          reason = (err as Error).message
          return null
        })
        const page = got?.text ?? ''
        const found = failedScenariosOnSpecPage(page).map((n) => (n.includes(': ') ? n : `${spec.name}: ${n}`))
        const fallback = found.length ? found : extractFailedTests(page)
        // A failed spec whose scenarios can't be read still counts, by its name.
        const list = fallback.length ? fallback : [spec.name]
        how.push(
          `${spec.name}: ${
            got
              ? `${found.length} failed scenario${found.length === 1 ? '' : 's'} found${found.length ? '' : fallback.length ? ' by layout' : ', listed by the spec name'}${got.partial ? ` (page incomplete: ${got.partial})` : ''}`
              : `couldn't be read (${reason}), listed by the spec name`
          }.`,
        )
        for (const n of list) if (!names.includes(n)) names.push(n)
      }
      return names
    }
  } else {
    how.push('Not recognised as a Gauge report.')
  }
  const found = extractFailedTests(html)
  const rows = (html.match(/<tr\b/gi) ?? []).length
  const failMarks = (html.match(/\b(fail|failed|failure|error)\b/gi) ?? []).length
  how.push(`Common layouts: ${found.length} failed test${found.length === 1 ? '' : 's'} (the page has ${rows} table rows and mentions fail/error ${failMarks} times).`)
  return found
}

/**
 * The run's report: a link pasted for it, its .html artifact, the project's
 * path for that kind of run, HTML Publisher's "HTML_20Report/" (the build's,
 * then the job's latest), or a report page linked on the build — followed
 * into the frame HTML Publisher wraps it in. Returns the page and what was tried.
 */
async function findReport(jenkins: JenkinsConnection, a: DueAnalysis, reportPath: string): Promise<{ url: string | null; html: string | null; tried: string[] }> {
  const tried: string[] = []
  const buildUrl = a.status?.url ?? null
  const read = async (url: string, label: string) => {
    try {
      let html = await reportGetText(jenkins, url)
      // HTML Publisher shows the report inside a frame (possibly from Jenkins' resource address).
      const frame = framedReport(html, url)
      if (frame) {
        html = await reportGetText(jenkins, frame)
        url = frame
      }
      return { url, html }
    } catch (err) {
      tried.push(`${label}: ${(err as Error).message}`)
      return null
    }
  }

  if (a.report_url) {
    // A pasted link must be on Jenkins (its frame may lead to Jenkins' resource address).
    if (new URL(a.report_url).host !== new URL(jenkins.baseUrl).host) tried.push('the pasted link is not on the connected Jenkins')
    else {
      const r = await read(a.report_url, 'the pasted link')
      if (r) return { ...r, tried }
    }
  }
  if (a.status?.reportUrl) {
    const r = await read(a.status.reportUrl, 'the .html artifact')
    if (r) return { ...r, tried }
  } else tried.push('no .html artifact')
  if (buildUrl && reportPath.trim()) {
    const r = await read(new URL(reportPath.trim().replace(/^\/+/, ''), buildUrl).toString(), `the path ${reportPath.trim()}`)
    if (r) return { ...r, tried }
  }
  if (buildUrl) {
    const r = await read(new URL('HTML_20Report/', buildUrl).toString(), 'HTML_20Report/ of the build')
    if (r) return { ...r, tried }
  }
  if (buildUrl) {
    try {
      const links = reportLinksFromBuildPage(await jenkinsGetText(jenkins, buildUrl), buildUrl)
      if (!links.length) tried.push('no report link on the build page')
      for (const link of links.slice(0, 3)) {
        const r = await read(link, `the build page link ${link}`)
        if (r) return { ...r, tried }
      }
    } catch (err) {
      tried.push(`the build page: ${(err as Error).message}`)
    }
  }
  if (buildUrl) {
    // The job's latest report (HTML Publisher without "keep past reports").
    const jobUrl = buildUrl.replace(/\/\d+\/?$/, '/')
    const r = await read(new URL('HTML_20Report/', jobUrl).toString(), 'HTML_20Report/ of the job')
    if (r) return { ...r, tried }
  }
  return { url: null, html: null, tried }
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
    try {
      const jenkins: JenkinsConnection = { baseUrl: a.jenkins_base_url, username: a.jenkins_username, secret: decrypt(a.jenkins_secret, key), ca: a.jenkins_ca }
      const reportPath = (settings.reportPaths as Record<string, string> | undefined)?.[a.purpose] ?? ''
      const report = await findReport(jenkins, a, reportPath)
      if (!report.url) {
        await db.query("select test_analysis_save($1, 'failed', null, $2)", [
          a.run_id,
          `No report found (looked at: ${report.tried.join('; ')}). Paste the report’s link below, or set where it is in Settings → Automation.`,
        ])
        out.failed++
        continue
      }
      const reportUrl = report.url
      const html = report.html!
      const failed = await readFailedTests(jenkins, reportUrl, html, settings.failedPattern || null)
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
