import type { CodeChange, CodeComparison, JiraIssue } from './api'

export type ComparisonTab = 'jiraOnly' | 'codeOnly' | 'noKey' | 'matched'

export const TAB_ORDER: ComparisonTab[] = ['jiraOnly', 'codeOnly', 'noKey', 'matched']

export function tabCounts(c: CodeComparison): Record<ComparisonTab, number> {
  return { jiraOnly: c.jiraOnly.length, codeOnly: c.codeOnly.length, noKey: c.noKey.length, matched: c.matched.length }
}

/** The first tab with a difference to look at; "matched" when everything lines up. */
export function defaultTab(c: CodeComparison): ComparisonTab {
  const counts = tabCounts(c)
  return TAB_ORDER.find((t) => t !== 'matched' && counts[t] > 0) ?? 'matched'
}

const has = (text: string | null | undefined, q: string) => !!text && text.toLowerCase().includes(q)
const issueMatches = (i: JiraIssue, q: string) => has(i.key, q) || has(i.summary, q) || has(i.assignee, q) || has(i.type, q) || has(i.status, q)
const changeMatches = (ch: CodeChange, q: string) => has(ch.ref, q) || has(ch.title, q) || has(ch.branch, q) || has(ch.author, q) || has(ch.repo, q)

/** Narrows every list to rows mentioning `query` (key, title, branch, author…). */
export function filterComparison(c: CodeComparison, query: string): CodeComparison {
  const q = query.trim().toLowerCase()
  if (!q) return c
  return {
    ...c,
    matched: c.matched.filter((m) => issueMatches(m.issue, q) || m.changes.some((ch) => changeMatches(ch, q))),
    jiraOnly: c.jiraOnly.filter((i) => issueMatches(i, q)),
    codeOnly: c.codeOnly.filter(
      (x) => has(x.key, q) || (x.jira && x.jira !== 'unknown' && has(x.jira.summary, q)) || x.changes.some((ch) => changeMatches(ch, q)),
    ),
    noKey: c.noKey.filter((ch) => changeMatches(ch, q)),
    otherCommits: c.otherCommits.filter((ch) => changeMatches(ch, q)),
    syncMerges: c.syncMerges.filter((ch) => changeMatches(ch, q)),
  }
}

/**
 * Issues with nothing merged, most suspicious first: marked Done in Jira
 * (claims to be finished, but no code reached the RC), then in progress, then
 * to do.
 */
export function sortJiraOnly(issues: JiraIssue[]): JiraIssue[] {
  const rank = { done: 0, indeterminate: 1, new: 2, unknown: 3 } as const
  return [...issues].sort((a, b) => rank[a.statusCategory] - rank[b.statusCategory] || a.key.localeCompare(b.key, undefined, { numeric: true }))
}

/** "Planned for 1.5.0", "No fix version", "Not found in Jira"… for a merged issue outside this version. */
export function elsewhereLabel(jira: CodeComparison['codeOnly'][number]['jira']): string {
  if (jira === 'unknown') return 'Not checked in Jira'
  if (jira === null) return 'Not found in Jira'
  if (jira.fixVersions.length === 0) return 'No fix version in Jira'
  return `Fix version: ${jira.fixVersions.map((v) => v.name).join(', ')}`
}
