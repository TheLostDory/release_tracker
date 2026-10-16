import type { Config } from '../config.js'
import type { Tx } from '../db/pool.js'
import { cached } from '../integrations/cache.js'
import type { JenkinsBuild } from '../integrations/jenkins.js'
import {
  jiraIssueVersions,
  jiraTextSearch,
  jiraVersionIssues,
  jiraVersions,
  type JiraConnection,
  type JiraIssue,
  type JiraIssueVersions,
  type JiraVersion,
} from '../integrations/jira.js'
import { jiraConnection, loadIntegration } from '../integrations/store.js'

/**
 * Gathers what the assistant may use to answer one question, as the asking
 * user (row level security applies, so it only sees their projects). The
 * model never calls tools itself: retrieval happens here, then the data goes
 * with the question. Jira/Jenkins failures become notes, not errors.
 */
export interface ChatSource {
  kind: 'release' | 'jira_issue' | 'jira_version'
  label: string
  url: string
}

export interface ChatContext {
  text: string
  sources: ChatSource[]
}

interface ReleaseRow {
  id: string
  name: string
  version: string
  description: string | null
  planned: string
  actual: string | null
  status_override: string | null
  status_override_reason: string | null
  jira_version_id: string | null
  jira_version_name: string | null
  sprint: string | null
  owner: string | null
  steps_done: number
  steps_total: number
  current_step: string | null
  blocked: string[]
  reports: string[]
  approval: string | null
}

const RELEASES_SQL = `
  select r.id, r.name, r.version, r.description, r.planned_deployment_date as planned, r.actual_deployment_date as actual,
         r.status_override, r.status_override_reason, r.jira_version_id, r.jira_version_name,
         s.name as sprint, u.name as owner,
         t.steps_done, t.steps_total, t.current_step, t.blocked,
         coalesce((select array_agg(p.report_type || '=' || p.result order by p.report_type) from reports p where p.release_id = r.id), '{}') as reports,
         (select a.status::text from approvals a where a.release_id = r.id) as approval
  from releases r
  left join sprints s on s.id = r.sprint_id
  left join users u on u.id = r.owner_id
  cross join lateral (
    select count(*) filter (where status in ('COMPLETED', 'SKIPPED'))::int as steps_done,
           count(*)::int as steps_total,
           (array_agg(name order by position) filter (where status not in ('COMPLETED', 'SKIPPED')))[1] as current_step,
           coalesce(array_agg(name || coalesce(' (' || blocker_reason || ')', '') order by position) filter (where status = 'BLOCKED'), '{}') as blocked
    from release_tasks where release_id = r.id
  ) t
  where r.project_id = $1
  order by r.planned_deployment_date desc
  limit 300`

const MAX_ISSUE_KEYS = 8
const MAX_FOCUS_VERSIONS = 3
const MAX_ISSUES_PER_VERSION = 200
const MAX_CONTEXT_CHARS = 120_000

const STOPWORDS = new Set(
  `a an and are as at be been by can did do does for from has have how i if in into is it its me my of on or our release releases
  released version versions shipped ship fixed fix the this that to was were what when where which who why will with you your
  about any all show list tell give find get there their them they we us please been being contain contains content contents
  included include includes issue issues ticket tickets bug bugs task tasks story stories feature features jira`.split(/\s+/),
)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when `name` (e.g. "1.4.0", "Spring launch") appears as a whole token in the text. */
export function mentions(text: string, name: string): boolean {
  const n = name.trim().toLowerCase()
  if (n.length < 2) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}.])${escapeRe(n)}(?![\\p{L}\\p{N}]|\\.[\\p{L}\\p{N}])`, 'u').test(text.toLowerCase())
}

/** Jira issue keys in the text: "ABC-123" anywhere, "abc-123" when it's the project's key. */
export function issueKeys(text: string, projectKey?: string): string[] {
  const keys = new Set<string>()
  for (const m of text.matchAll(/\b([A-Za-z][A-Za-z0-9_]{1,19})-(\d{1,9})\b/g)) {
    const prefix = m[1]!
    if (prefix === prefix.toUpperCase() || prefix.toUpperCase() === projectKey) keys.add(`${prefix.toUpperCase()}-${m[2]}`)
  }
  return [...keys].slice(0, MAX_ISSUE_KEYS)
}

/** Words worth a Jira full-text search ("login timeout" from "which version fixed the login timeout?"). */
export function searchWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .slice(0, 6)
}

const releaseLine = (r: ReleaseRow) =>
  [
    `- ${r.name} (version ${r.version})`,
    `planned ${r.planned}`,
    r.actual ? `DEPLOYED ${r.actual}` : 'not deployed yet',
    r.sprint && `sprint ${r.sprint}`,
    r.owner && `owner ${r.owner}`,
    `steps ${r.steps_done}/${r.steps_total} done`,
    r.current_step && `next step: ${r.current_step}`,
    r.blocked.length > 0 && `BLOCKED: ${r.blocked.join('; ')}`,
    r.reports.length > 0 && `reports: ${r.reports.join(', ')}`,
    r.approval && `approval ${r.approval}`,
    r.status_override && `status set to ${r.status_override}${r.status_override_reason ? ` (${r.status_override_reason})` : ''}`,
    r.jira_version_name && `Jira version ${r.jira_version_name}`,
    `[release id ${r.id}]`,
  ]
    .filter(Boolean)
    .join(' · ')

const issueLine = (i: JiraIssue | JiraIssueVersions) =>
  `  - ${i.key} [${i.type}] ${i.status}${i.assignee ? ` · ${i.assignee}` : ''} — ${i.summary}`

const fixVersionText = (i: JiraIssueVersions) =>
  i.fixVersions.length
    ? i.fixVersions.map((v) => `${v.name} (${v.released ? `released${v.releaseDate ? ` ${v.releaseDate}` : ''}` : 'unreleased'})`).join(', ')
    : 'no fix version'

function describeBuild(job: { job_path: string; purpose: string; last_build: JenkinsBuild | null; last_error: string | null }) {
  const b = job.last_build
  const build = !b
    ? 'no builds'
    : `#${b.number} ${b.building ? 'RUNNING' : (b.result ?? 'UNKNOWN')} at ${new Date(b.timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC (${b.url})`
  return `  - ${job.job_path} (${job.purpose}): ${build}${job.last_error ? ` · error: ${job.last_error}` : ''}`
}

export async function buildChatContext(tx: Tx, config: Config, projectId: string, question: string): Promise<ChatContext> {
  const sources: ChatSource[] = []
  const notes: string[] = []
  const sections: string[] = []

  const project = (await tx.query<{ name: string }>('select name from projects where id = $1', [projectId])).rows[0]
  const releases = (await tx.query<ReleaseRow>(RELEASES_SQL, [projectId])).rows

  // --- Jira connection (optional) ------------------------------------------------------
  let jira: { conn: JiraConnection; id: string; projectKey: string; baseUrl: string } | null = null
  try {
    const { row, secret } = await loadIntegration(tx, config, projectId, 'JIRA')
    if (row.settings.projectKey) jira = { conn: jiraConnection(row, secret), id: row.id, projectKey: row.settings.projectKey, baseUrl: row.base_url }
  } catch {
    notes.push('Jira is not connected (or not readable) for this project, so Jira content is unavailable.')
  }
  const jiraFailed = (what: string, err: unknown) => notes.push(`Jira ${what} failed: ${(err as Error).message}`)

  let versions: JiraVersion[] = []
  if (jira) {
    const j = jira
    try {
      versions = await cached(`versions:${j.id}`, 60_000, () => jiraVersions(j.conn, j.projectKey))
    } catch (err) {
      jiraFailed('version list', err)
    }
  }

  // --- What the question is about --------------------------------------------------------
  const focus = releases.filter((r) => mentions(question, r.version) || mentions(question, r.name) || (r.jira_version_name && mentions(question, r.jira_version_name)))
  const focusIds = new Set(focus.map((r) => r.id))
  const mentionedVersions = versions.filter((v) => mentions(question, v.name))
  const keys = issueKeys(question, jira?.projectKey)

  // Nothing specific named: look at the next release and the latest deployed one.
  if (focus.length === 0 && mentionedVersions.length === 0 && keys.length === 0) {
    const today = new Date().toISOString().slice(0, 10)
    const upcoming = releases.filter((r) => !r.actual).sort((a, b) => (a.planned < b.planned ? -1 : 1))
    const next = upcoming.find((r) => r.planned >= today) ?? upcoming.at(-1)
    const lastDeployed = releases.filter((r) => r.actual).sort((a, b) => (a.actual! > b.actual! ? -1 : 1))[0]
    for (const r of [next, lastDeployed]) {
      if (r && !focusIds.has(r.id)) {
        focus.push(r)
        focusIds.add(r.id)
      }
    }
  }

  // --- Tracker releases --------------------------------------------------------------------
  sections.push(
    `## Releases in the tracker (${releases.length}${releases.length === 300 ? '+, newest 300' : ''}; newest planned first)\n` +
      (releases.length ? releases.map(releaseLine).join('\n') : '(none)'),
  )

  // --- Focus releases: description, Jenkins, Jira content -----------------------------------
  const versionIssueIds = new Map<string, string>() // jira version id → name
  for (const v of mentionedVersions) versionIssueIds.set(v.id, v.name)
  for (const r of focus) if (r.jira_version_id) versionIssueIds.set(r.jira_version_id, r.jira_version_name ?? r.version)

  if (focus.length) {
    const jobs = (
      await tx.query<{ release_id: string; job_path: string; purpose: string; last_build: JenkinsBuild | null; last_error: string | null }>(
        'select release_id, job_path, purpose::text, last_build, last_error from release_jenkins_jobs where release_id = any($1) order by purpose, job_path',
        [[...focusIds]],
      )
    ).rows
    for (const r of focus) {
      const own = jobs.filter((j) => j.release_id === r.id)
      sections.push(
        [
          `## Release ${r.name} (version ${r.version}) — details`,
          r.description && `Description: ${r.description.slice(0, 2000)}`,
          own.length ? `Jenkins jobs (latest build):\n${own.map(describeBuild).join('\n')}` : 'Jenkins jobs: none linked',
          r.jira_version_name ? `Jira version: ${r.jira_version_name}` : 'Not linked to a Jira version',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      sources.push({ kind: 'release', label: `${r.name} (${r.version})`, url: `/releases/${r.id}` })
    }
  }

  if (jira) {
    const j = jira
    // Content of the Jira versions in focus.
    for (const [versionId, name] of [...versionIssueIds].slice(0, MAX_FOCUS_VERSIONS)) {
      try {
        const { issues, truncated } = await cached(`issues:${j.id}:${versionId}`, 60_000, () => jiraVersionIssues(j.conn, versionId))
        const v = versions.find((x) => x.id === versionId)
        const shown = issues.slice(0, MAX_ISSUES_PER_VERSION)
        const byType = new Map<string, number>()
        for (const i of issues) byType.set(i.type, (byType.get(i.type) ?? 0) + 1)
        const counts = [...byType].map(([t, n]) => `${n} ${t}`)
        sections.push(
          `## Jira version ${name}${v ? ` (${v.released ? `released${v.releaseDate ? ` ${v.releaseDate}` : ''}` : `unreleased${v.releaseDate ? `, planned ${v.releaseDate}` : ''}`})` : ''}: ${issues.length}${truncated ? '+' : ''} issues (${counts.join(', ') || 'none'})\n` +
            (shown.length ? shown.map(issueLine).join('\n') : '  (no issues)') +
            (issues.length > shown.length ? `\n  … and ${issues.length - shown.length} more not listed` : ''),
        )
        sources.push({ kind: 'jira_version', label: `Jira ${name}`, url: `${j.baseUrl}/projects/${j.projectKey}/versions/${versionId}` })
      } catch (err) {
        jiraFailed(`issues of version ${name}`, err)
      }
    }

    // Specific issues: which version(s) they are in.
    if (keys.length) {
      const found = await Promise.all(keys.map((k) => jiraIssueVersions(j.conn, k).catch((err: unknown) => (jiraFailed(`lookup of ${k}`, err), undefined))))
      const lines = keys.map((k, i) => {
        const issue = found[i]
        if (issue === undefined) return `- ${k}: lookup failed`
        if (issue === null) return `- ${k}: does not exist in Jira (or this Jira account can't see it)`
        sources.push({ kind: 'jira_issue', label: issue.key, url: issue.url })
        return `${issueLine(issue).trimStart()}\n    fix versions: ${fixVersionText(issue)}`
      })
      sections.push(`## Jira issues asked about\n${lines.join('\n')}`)
    }

    // Free-text questions ("which version fixed the login timeout?").
    if (keys.length === 0 && mentionedVersions.length === 0) {
      const words = searchWords(question)
      if (words.length) {
        try {
          const hits = await jiraTextSearch(j.conn, j.projectKey, words)
          sections.push(
            `## Jira search for "${words.join(' ')}" (${hits.length} best matches)\n` +
              (hits.length ? hits.map((i) => `${issueLine(i)}\n    fix versions: ${fixVersionText(i)}`).join('\n') : '  (no matches)'),
          )
          for (const i of hits.slice(0, 5)) sources.push({ kind: 'jira_issue', label: i.key, url: i.url })
        } catch (err) {
          jiraFailed('search', err)
        }
      }
    }

    // Jira versions not imported into the tracker (so "when was 1.2 released?" still works).
    const linked = new Set(releases.map((r) => r.jira_version_id).filter(Boolean))
    const unlinked = versions.filter((v) => !linked.has(v.id) && !v.archived)
    if (unlinked.length) {
      sections.push(
        `## Other Jira versions (not in the tracker)\n` +
          unlinked
            .slice(0, 100)
            .map((v) => `- ${v.name}: ${v.released ? 'released' : 'unreleased'}${v.releaseDate ? ` ${v.releaseDate}` : ''}${v.description ? ` — ${v.description}` : ''}`)
            .join('\n'),
      )
    }
  }

  if (notes.length) sections.push(`## Notes\n${notes.map((n) => `- ${n}`).join('\n')}`)

  let text = `Project: ${project?.name ?? 'unknown'}\nToday: ${new Date().toISOString().slice(0, 10)}\n\n${sections.join('\n\n')}`
  if (text.length > MAX_CONTEXT_CHARS) text = `${text.slice(0, MAX_CONTEXT_CHARS)}\n… (data truncated)`
  return { text, sources: dedupe(sources) }
}

function dedupe(sources: ChatSource[]): ChatSource[] {
  const seen = new Set<string>()
  return sources.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
}
