import { Router } from 'express'
import { z } from 'zod'
import type { Config } from '../config.js'
import type { Db, Tx } from '../db/pool.js'
import { userId } from '../auth/sessions.js'
import { forbidden, HttpError, notFound } from '../http/errors.js'
import { asUser, idParam } from '../http/helpers.js'
import { cached, uncache } from '../integrations/cache.js'
import { compareWithJira, toChanges, type Change } from '../integrations/code-compare.js'
import { githubCompare, githubPull, githubWebUrl, isRefName, type GitHubConnection, type PullRequest } from '../integrations/github.js'
import { jiraIssueVersions, jiraVersionIssues, type JiraIssueVersions } from '../integrations/jira.js'
import { asHttpError, OutboundError } from '../integrations/outbound.js'
import { githubConnection, jiraConnection, loadIntegration, type IntegrationRow } from '../integrations/store.js'

const refsBody = z.strictObject({
  refs: z
    .array(
      z.strictObject({
        repo: z.string().trim(),
        baseRef: z.string().trim().min(1).max(250).refine(isRefName, 'not a valid branch or tag name'),
        headRef: z.string().trim().min(1).max(250).refine(isRefName, 'not a valid branch or tag name'),
      }),
    )
    .max(10),
})

const MAX_PULLS_PER_REPO = 200
const MAX_KEY_LOOKUPS = 50

interface ReleaseRow {
  id: string
  project_id: string
  name: string
  version: string
  planned_deployment_date: string
  jira_version_id: string | null
  jira_version_name: string | null
}

const fillTemplate = (t: string, r: { name: string; version: string }) => t.replaceAll('{{version}}', r.version).replaceAll('{{name}}', r.name)

async function release(tx: Tx, id: string) {
  const { rows } = await tx.query<ReleaseRow>(
    'select id, project_id, name, version, planned_deployment_date, jira_version_id, jira_version_name from releases where id = $1',
    [id],
  )
  if (!rows[0]) throw notFound('Release not found.')
  return rows[0]
}

async function optionalIntegration(tx: Tx, config: Config, projectId: string, kind: 'GITHUB' | 'JIRA') {
  try {
    return await loadIntegration(tx, config, projectId, kind)
  } catch (err) {
    if (err instanceof HttpError && err.code === 'not_connected') return null
    throw err
  }
}

/** A few at a time: be gentle with GitHub/Jira. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

type Integration = { row: IntegrationRow; secret: string }

/**
 * Compares a release's RC (GitHub) with its Jira version. Used by the page
 * (as the signed-in user) and by the background check (lookups off: only the
 * counts are kept). Returns the full result and the counts to store.
 */
export async function runComparison(input: {
  release: Pick<ReleaseRow, 'id' | 'name' | 'version' | 'jira_version_id' | 'jira_version_name'>
  refs: { repo: string; base_ref: string; head_ref: string }[]
  gh: Integration
  jira: Integration | null
  fresh: boolean
  lookups: boolean
}) {
  const { release: r, refs, gh, jira, fresh } = input
  const projectKey = jira?.row.settings.projectKey ?? null
  const notes: string[] = []

  // --- Code: commits in each RC, and the pull requests they came from ---------------
  const conn = githubConnection(gh.row, gh.secret)
  const repos = await mapLimited(refs, 2, (ref) => compareRepo(conn, gh.row, ref, projectKey, fresh))
  const changes = repos.flatMap((x) => x.changes)
  for (const x of repos) if (x.error) notes.push(`${x.repo}: ${x.error}`)

  // --- Jira: the release's version ----------------------------------------------------
  let issues: Awaited<ReturnType<typeof jiraVersionIssues>>['issues'] = []
  let jiraInfo: { versionName: string; url: string; truncated: boolean } | null = null
  if (!jira) notes.push('Jira is not connected, so only the code side is shown.')
  else if (!r.jira_version_id) notes.push('This release is not linked to a Jira version. Link it on the release page to compare.')
  else {
    const key = `issues:${jira.row.id}:${r.jira_version_id}`
    if (fresh) uncache(key)
    const result = await cached(key, 60_000, () => jiraVersionIssues(jiraConnection(jira.row, jira.secret), r.jira_version_id!)).catch(asHttpError)
    issues = result.issues
    jiraInfo = {
      versionName: r.jira_version_name ?? r.version,
      url: `${jira.row.base_url}/projects/${projectKey}/versions/${r.jira_version_id}`,
      truncated: result.truncated,
    }
  }

  const comparison = compareWithJira(changes, jiraInfo ? issues : [])
  // Issues merged but not in this version: where are they planned instead?
  let codeOnly: Array<{ key: string; changes: Change[]; jira: JiraIssueVersions | null | 'unknown' }> = comparison.codeOnly.map((c) => ({
    ...c,
    jira: 'unknown' as const,
  }))
  if (input.lookups && jira && jiraInfo) {
    const jc = jiraConnection(jira.row, jira.secret)
    const lookups = codeOnly.slice(0, MAX_KEY_LOOKUPS)
    const found = await mapLimited(lookups, 4, (c) =>
      cached(`issue:${jira.row.id}:${c.key}`, 5 * 60_000, () => jiraIssueVersions(jc, c.key)).catch(() => 'unknown' as const),
    )
    codeOnly = codeOnly.map((c, i) => (i < found.length ? { ...c, jira: found[i]! } : c))
    if (comparison.codeOnly.length > MAX_KEY_LOOKUPS) notes.push(`Only the first ${MAX_KEY_LOOKUPS} extra issues were looked up in Jira.`)
  }

  const repoErrors = repos.filter((x) => x.error).map((x) => `${x.repo}: ${x.error}`)
  const summary = {
    jiraOnly: comparison.jiraOnly.length,
    jiraOnlyDone: comparison.jiraOnly.filter((i) => i.statusCategory === 'done').length,
    codeOnly: codeOnly.length,
    noKey: comparison.noKey.length,
    matched: comparison.matched.length,
    totalCommits: repos.reduce((n, x) => n + x.totalCommits, 0),
    hasJira: !!jiraInfo,
    error: repoErrors.length ? repoErrors.join('; ').slice(0, 1000) : null,
  }
  const result = {
    release: { id: r.id, name: r.name, version: r.version },
    jira: jiraInfo,
    repos: repos.map(({ changes: _changes, ...x }) => x),
    ...comparison,
    codeOnly,
    notes,
    comparedAt: new Date().toISOString(),
  }
  return { result, summary }
}

export function codeCompareRoutes(db: Db, config: Config) {
  const router = Router()

  /** Configured refs per repository, plus suggestions from the RC pattern and the previous release. */
  router.get('/releases/:id/code-refs', async (req, res) => {
    const releaseId = idParam(req)
    const data = await asUser(db, req, async (tx) => {
      const r = await release(tx, releaseId)
      const gh = await optionalIntegration(tx, config, r.project_id, 'GITHUB')
      if (!gh) return { connected: false as const }
      const refs = (await tx.query('select repo, base_ref, head_ref from release_code_refs where release_id = $1 order by repo', [releaseId])).rows
      const template = gh.row.settings.headTemplate || 'release/{{version}}'
      // The release planned just before this one: its RC is the natural base.
      const prev = (
        await tx.query<{ id: string; name: string; version: string }>(
          `select id, name, version from releases
           where project_id = $1 and id <> $2 and planned_deployment_date <= $3
           order by planned_deployment_date desc, created_at desc limit 1`,
          [r.project_id, r.id, r.planned_deployment_date],
        )
      ).rows[0]
      const prevRefs = prev
        ? (await tx.query<{ repo: string; head_ref: string }>('select repo, head_ref from release_code_refs where release_id = $1', [prev.id])).rows
        : []
      const suggestions = (gh.row.settings.repos ?? []).map((repo) => ({
        repo,
        headRef: fillTemplate(template, r),
        baseRef: prevRefs.find((p) => p.repo === repo)?.head_ref ?? (prev ? fillTemplate(template, prev) : ''),
      }))
      return {
        connected: true as const,
        repos: gh.row.settings.repos ?? [],
        webUrl: githubWebUrl(gh.row.base_url),
        refs,
        suggestions,
        previousRelease: prev ? { id: prev.id, name: prev.name, version: prev.version } : null,
      }
    })
    res.json(data)
  })

  router.put('/releases/:id/code-refs', async (req, res) => {
    const releaseId = idParam(req)
    const body = refsBody.parse(req.body)
    await asUser(db, req, async (tx) => {
      const r = await release(tx, releaseId)
      const role = await tx.query<{ ok: boolean }>("select coalesce(project_role_of($1) >= 'MEMBER'::project_role, false) as ok", [r.project_id])
      if (!role.rows[0]?.ok) throw forbidden()
      const gh = await loadIntegration(tx, config, r.project_id, 'GITHUB')
      const allowed = new Set(gh.row.settings.repos ?? [])
      const unknown = body.refs.find((x) => !allowed.has(x.repo))
      if (unknown) throw new HttpError(422, `${unknown.repo} isn't one of the project's GitHub repositories.`, 'invalid')
      await tx.query('delete from release_code_refs where release_id = $1', [releaseId])
      await tx.query('select clear_code_check($1)', [releaseId])
      for (const x of body.refs) {
        await tx.query('insert into release_code_refs (release_id, repo, base_ref, head_ref, created_by) values ($1, $2, $3, $4, $5)', [
          releaseId,
          x.repo,
          x.baseRef,
          x.headRef,
          userId(req),
        ])
      }
    })
    res.status(204).end()
  })

  /** What was merged into the RC vs. what the Jira version contains. */
  router.get('/releases/:id/code-compare', async (req, res) => {
    const releaseId = idParam(req)
    const fresh = req.query.refresh === 'true'
    const data = await asUser(db, req, async (tx) => {
      const r = await release(tx, releaseId)
      const gh = await loadIntegration(tx, config, r.project_id, 'GITHUB')
      const refs = (
        await tx.query<{ repo: string; base_ref: string; head_ref: string }>(
          'select repo, base_ref, head_ref from release_code_refs where release_id = $1 order by repo',
          [releaseId],
        )
      ).rows
      if (refs.length === 0) throw new HttpError(409, 'Choose the RC branch or tag to compare first.', 'not_configured')
      const jira = await optionalIntegration(tx, config, r.project_id, 'JIRA')
      const { result, summary } = await runComparison({ release: r, refs, gh, jira, fresh, lookups: true })
      // Latest result, for the releases list, the dashboard and Teams alerts.
      await tx.query('select record_code_check($1, $2)', [r.id, JSON.stringify(summary)])
      return result
    })
    res.json(data)
  })

  return router
}

async function compareRepo(
  conn: GitHubConnection,
  row: IntegrationRow,
  ref: { repo: string; base_ref: string; head_ref: string },
  projectKey: string | null,
  fresh: boolean,
) {
  const base = { repo: ref.repo, baseRef: ref.base_ref, headRef: ref.head_ref }
  try {
    const key = `compare:${row.id}:${ref.repo}:${ref.base_ref}...${ref.head_ref}`
    if (fresh) uncache(key)
    const cmp = await cached(key, 2 * 60_000, () => githubCompare(conn, ref.repo, ref.base_ref, ref.head_ref))
    // Pull request numbers from merge/squash commit titles; details fill in titles and branch names.
    const numbers = [
      ...new Set(
        cmp.commits.flatMap((c) => {
          const line = c.message.split('\n', 1)[0]!
          const m = /^Merge pull request #(\d+)/.exec(line) ?? /\(#(\d+)\)\s*$/.exec(line)
          return m ? [Number(m[1])] : []
        }),
      ),
    ].slice(0, MAX_PULLS_PER_REPO)
    const pulls = new Map<number, PullRequest>()
    const details = await mapLimited(numbers, 4, (n) =>
      cached(`pull:${row.id}:${ref.repo}:${n}`, 30 * 60_000, () => githubPull(conn, ref.repo, n)).catch(() => null),
    )
    for (const p of details) if (p) pulls.set(p.number, p)
    return {
      ...base,
      totalCommits: cmp.total,
      truncated: cmp.truncated,
      compareUrl: cmp.compareUrl,
      error: null as string | null,
      changes: toChanges(ref.repo, cmp.commits, pulls, projectKey),
    }
  } catch (err) {
    if (!(err instanceof OutboundError)) throw err
    return { ...base, totalCommits: 0, truncated: false, compareUrl: '', error: err.message, changes: [] as Change[] }
  }
}
