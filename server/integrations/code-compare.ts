import type { GitCommit, PullRequest } from './github.js'
import type { JiraIssue } from './jira.js'

/**
 * Compares what was merged into a release candidate with the issues in its
 * Jira version. Pure functions: the route gathers commits, pull requests and
 * issues, this decides what matches.
 */

/** One unit of change: a merged pull request, a branch merge, or a direct commit. */
export interface Change {
  repo: string
  kind: 'pr' | 'merge' | 'commit'
  /** "#123" for pull requests, the short SHA otherwise. */
  ref: string
  title: string
  branch: string | null
  author: string | null
  date: string | null
  url: string
  keys: string[]
}

export interface ComparisonResult {
  /** Jira issues with merged changes. */
  matched: { issue: JiraIssue; changes: Change[] }[]
  /** In the Jira version, but nothing merged mentions them. */
  jiraOnly: JiraIssue[]
  /** Merged changes that mention issues NOT in the Jira version. */
  codeOnly: { key: string; changes: Change[] }[]
  /** Pull requests and branch merges that mention no issue at all. */
  noKey: Change[]
  /** Direct commits that mention no issue (often the commits inside merged PRs). */
  otherCommits: Change[]
  /** Merges that only bring other release/main branches in (ignored). */
  syncMerges: Change[]
}

// Upper-case words that look like issue keys but aren't.
const NOT_KEYS = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'CVE', 'HTTP', 'HTTPS', 'TLS', 'SSL', 'AES', 'RSA', 'X', 'PR', 'MR', 'V', 'GPT', 'ES', 'IPV'])

/**
 * Issue keys in text. The project's own key matches in any case (branch names
 * are often lower case: feature/abc-123-login); other keys only in upper case.
 */
export function findIssueKeys(text: string, projectKey: string | null): string[] {
  const keys = new Set<string>()
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,19})-(\d{1,9})(?![0-9])/g)) {
    const prefix = m[1]!
    const upper = prefix.toUpperCase()
    const own = projectKey !== null && upper === projectKey
    if (!own && (prefix !== upper || NOT_KEYS.has(upper) || upper.length < 2 || /^\d/.test(upper))) continue
    keys.add(`${upper}-${Number(m[2])}`)
  }
  return [...keys]
}

const firstLine = (message: string) => message.split('\n', 1)[0]!.trim()
const restLines = (message: string) =>
  message
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)

/** Branches that are other release lines rather than work: merging them in is a sync. */
export const isLongLivedBranch = (branch: string) =>
  /^(origin\/)?(main|master|develop|dev|trunk|release[/-].*|releases?\/.*|hotfix[/-].*|rc[/-].*)$/i.test(branch)

/** Turns commits (plus pull request details, when known) into changes. */
export function toChanges(repo: string, commits: GitCommit[], pulls: Map<number, PullRequest>, projectKey: string | null) {
  const changes: Change[] = []
  const seenPrs = new Set<number>()
  for (const c of commits) {
    const line = firstLine(c.message)
    const short = c.sha.slice(0, 7)
    // "Merge pull request #12 from owner/feature/ABC-1-x" (merge commit) or "Title (#12)" (squash / rebase).
    const merged = /^Merge pull request #(\d+) from (\S+)/.exec(line)
    const squashed = merged ? null : /\(#(\d+)\)\s*$/.exec(line)
    const prNumber = merged ? Number(merged[1]) : squashed ? Number(squashed[1]) : null
    if (prNumber !== null) {
      if (seenPrs.has(prNumber)) continue
      seenPrs.add(prNumber)
      const pr = pulls.get(prNumber)
      const branch = pr?.branch ?? (merged ? merged[2]!.split('/').slice(1).join('/') || merged[2]! : null)
      const title = pr?.title ?? (merged ? (restLines(c.message)[0] ?? line) : line.replace(/\s*\(#\d+\)\s*$/, ''))
      changes.push({
        repo,
        kind: 'pr',
        ref: `#${prNumber}`,
        title,
        branch,
        author: pr?.author ?? c.author,
        date: pr?.mergedAt ?? c.date,
        url: pr?.url ?? c.url,
        keys: findIssueKeys([title, branch ?? '', c.message].join('\n'), projectKey),
      })
      continue
    }
    // "Merge branch 'feature/ABC-1' into release/1.4", "Merge remote-tracking branch 'origin/x'".
    const branchMerge = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(line)
    if (branchMerge || c.parents > 1) {
      const branch = branchMerge?.[1] ?? null
      changes.push({
        repo,
        kind: 'merge',
        ref: short,
        title: line,
        branch,
        author: c.author,
        date: c.date,
        url: c.url,
        keys: findIssueKeys(c.message, projectKey),
      })
      continue
    }
    changes.push({ repo, kind: 'commit', ref: short, title: line, branch: null, author: c.author, date: c.date, url: c.url, keys: findIssueKeys(c.message, projectKey) })
  }
  return changes
}

export function compareWithJira(changes: Change[], issues: JiraIssue[]): ComparisonResult {
  const byKey = new Map<string, Change[]>()
  const noKey: Change[] = []
  const otherCommits: Change[] = []
  const syncMerges: Change[] = []
  for (const ch of changes) {
    if (ch.keys.length === 0) {
      if (ch.kind === 'merge' && (!ch.branch || isLongLivedBranch(ch.branch))) syncMerges.push(ch)
      else if (ch.kind === 'commit') otherCommits.push(ch)
      else noKey.push(ch)
      continue
    }
    for (const key of ch.keys) byKey.set(key, [...(byKey.get(key) ?? []), ch])
  }
  const inJira = new Set(issues.map((i) => i.key))
  return {
    matched: issues.filter((i) => byKey.has(i.key)).map((issue) => ({ issue, changes: byKey.get(issue.key)! })),
    jiraOnly: issues.filter((i) => !byKey.has(i.key)),
    codeOnly: [...byKey]
      .filter(([key]) => !inJira.has(key))
      .map(([key, list]) => ({ key, changes: list }))
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true })),
    noKey,
    otherCommits,
    syncMerges,
  }
}
