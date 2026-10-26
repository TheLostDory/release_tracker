import { HttpError } from '../http/errors.js'
import { OutboundError, outboundJson } from './outbound.js'

/**
 * GitHub REST API (github.com or GitHub Enterprise Server). Read-only: the
 * token needs read access to the repositories' contents and pull requests.
 */
export interface GitHubConnection {
  /** API address: https://api.github.com or https://<host>/api/v3. */
  apiUrl: string
  secret: string
  ca?: string | null
}

const SERVICE = 'GitHub'
const MAX_COMMITS = 3000

export const isRepoName = (s: string) => /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(s)

/** Branch or tag name as git allows it, minus anything that could change the API path. */
export const isRefName = (s: string) => s.length <= 250 && /^[^\s~^:?*[\\]+$/.test(s) && !s.includes('..') && !s.startsWith('/') && !s.endsWith('/')

/**
 * "https://github.com" → the public API; "https://github.company.com" →
 * its Enterprise API (/api/v3). An API address given as such is kept.
 */
export function normalizeGitHubApiUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new HttpError(422, 'Enter a full URL, e.g. https://github.com or https://github.yourcompany.com', 'invalid')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(422, 'Use an http(s) URL.', 'invalid')
  if (url.username || url.password) throw new HttpError(422, "Don't put credentials in the URL.", 'invalid')
  const host = url.host.toLowerCase()
  if (host === 'github.com' || host === 'www.github.com' || host === 'api.github.com') return 'https://api.github.com'
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${/\/api\/v3$/.test(path) ? path : `${path}/api/v3`}`
}

/** The web address matching an API address (for links). */
export const githubWebUrl = (apiUrl: string) => (apiUrl === 'https://api.github.com' ? 'https://github.com' : apiUrl.replace(/\/api\/v3$/, ''))

function headers(c: GitHubConnection): Record<string, string> {
  return { authorization: `Bearer ${c.secret}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
}

const get = <T>(c: GitHubConnection, path: string) => outboundJson<T>(`${c.apiUrl}${path}`, SERVICE, { headers: headers(c), ca: c.ca, errorDetail: true })

/** Keeps "/" in branch names (release/1.4) while encoding everything else. */
const refPath = (ref: string) => ref.split('/').map(encodeURIComponent).join('/')

/** Verifies the token; returns the account's login. */
export async function githubWhoAmI(c: GitHubConnection): Promise<string> {
  const me = await get<{ login?: string }>(c, '/user')
  return me.login ?? 'unknown'
}

export async function githubRepo(c: GitHubConnection, repo: string): Promise<{ fullName: string; defaultBranch: string }> {
  try {
    const r = await get<{ full_name?: string; default_branch?: string }>(c, `/repos/${repo}`)
    return { fullName: r.full_name ?? repo, defaultBranch: r.default_branch ?? 'main' }
  } catch (err) {
    if (err instanceof OutboundError && err.status === 404) {
      throw new OutboundError(`GitHub: repository ${repo} not found, or the token can't read it.`, 404)
    }
    throw err
  }
}

export interface GitCommit {
  sha: string
  message: string
  author: string | null
  date: string | null
  url: string
  parents: number
}

/**
 * Commits in `head` that aren't in `base` (GitHub's base...head comparison),
 * oldest first, up to MAX_COMMITS.
 */
export async function githubCompare(c: GitHubConnection, repo: string, base: string, head: string) {
  interface RawCompare {
    total_commits?: number
    html_url?: string
    commits?: Array<{
      sha: string
      html_url: string
      parents?: unknown[]
      author?: { login?: string } | null
      commit: { message: string; author?: { name?: string; date?: string } | null }
    }>
  }
  const commits: GitCommit[] = []
  let total = 0
  let compareUrl = ''
  for (let page = 1; page <= MAX_COMMITS / 100; page++) {
    let res: RawCompare
    try {
      res = await get<RawCompare>(c, `/repos/${repo}/compare/${refPath(base)}...${refPath(head)}?per_page=100&page=${page}`)
    } catch (err) {
      if (err instanceof OutboundError && err.status === 404) {
        throw new OutboundError(`GitHub: couldn't compare ${repo} ${base}...${head}. Check that both branches/tags exist.`, 404)
      }
      throw err
    }
    total = res.total_commits ?? total
    compareUrl = res.html_url ?? compareUrl
    const batch = res.commits ?? []
    for (const x of batch) {
      commits.push({
        sha: x.sha,
        message: x.commit.message,
        author: x.author?.login ?? x.commit.author?.name ?? null,
        date: x.commit.author?.date ?? null,
        url: x.html_url,
        parents: x.parents?.length ?? 1,
      })
    }
    if (batch.length < 100 || commits.length >= total) break
  }
  return { commits, total, truncated: total > commits.length, compareUrl }
}

export interface PullRequest {
  number: number
  title: string
  branch: string | null
  author: string | null
  url: string
  mergedAt: string | null
}

/** One pull request, or null if it doesn't exist (e.g. a number in a message that isn't a PR). */
export async function githubPull(c: GitHubConnection, repo: string, number: number): Promise<PullRequest | null> {
  try {
    const p = await get<{ number: number; title?: string; html_url: string; merged_at?: string | null; head?: { ref?: string }; user?: { login?: string } }>(
      c,
      `/repos/${repo}/pulls/${number}`,
    )
    return { number: p.number, title: p.title ?? '', branch: p.head?.ref ?? null, author: p.user?.login ?? null, url: p.html_url, mergedAt: p.merged_at ?? null }
  } catch (err) {
    if (err instanceof OutboundError && err.status === 404) return null
    throw err
  }
}

/** Whether a branch exists in the repository (404 → false). */
export async function githubBranchExists(c: GitHubConnection, repo: string, branch: string): Promise<boolean> {
  if (!isRepoName(repo) || !isRefName(branch)) return false
  try {
    await get(c, `/repos/${repo}/branches/${refPath(branch)}`)
    return true
  } catch (err) {
    if (err instanceof OutboundError && err.status === 404) return false
    throw err
  }
}
