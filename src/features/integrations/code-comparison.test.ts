import { describe, expect, it } from 'vitest'
import type { CodeChange, CodeComparison, JiraIssue } from './api'
import { defaultTab, elsewhereLabel, filterComparison, sortJiraOnly, tabCounts } from './code-comparison'

const issue = (key: string, statusCategory: JiraIssue['statusCategory'] = 'new', summary = `Summary ${key}`): JiraIssue => ({
  key,
  summary,
  type: 'Story',
  status: statusCategory,
  statusCategory,
  priority: null,
  assignee: null,
  url: `https://jira/browse/${key}`,
})
const change = (ref: string, title: string, branch: string | null = null): CodeChange => ({
  repo: 'acme/app',
  kind: 'pr',
  ref,
  title,
  branch,
  author: 'maya',
  date: null,
  url: `https://github/${ref}`,
  keys: [],
})
const comparison = (over: Partial<CodeComparison> = {}): CodeComparison => ({
  release: { id: 'r', name: 'RC', version: '1.4.0' },
  jira: { versionName: '1.4.0', url: 'https://jira', truncated: false },
  repos: [],
  matched: [{ issue: issue('ABC-1', 'done', 'Login'), changes: [change('#12', 'Login with SSO', 'feature/abc-1-sso')] }],
  jiraOnly: [issue('ABC-3'), issue('ABC-2', 'done', 'Search')],
  codeOnly: [],
  noKey: [change('#14', 'Bump dependencies')],
  otherCommits: [],
  syncMerges: [],
  notes: [],
  comparedAt: '',
  ...over,
})

describe('code comparison view', () => {
  it('opens on the first tab with a difference', () => {
    expect(defaultTab(comparison())).toBe('jiraOnly')
    expect(defaultTab(comparison({ jiraOnly: [] }))).toBe('noKey')
    expect(defaultTab(comparison({ jiraOnly: [], noKey: [] }))).toBe('matched')
    expect(tabCounts(comparison())).toEqual({ jiraOnly: 2, codeOnly: 0, noKey: 1, matched: 1 })
  })

  it('searches keys, titles and branch names', () => {
    const c = filterComparison(comparison(), 'sso')
    expect(c.matched).toHaveLength(1)
    expect(c.jiraOnly).toHaveLength(0)
    expect(filterComparison(comparison(), 'abc-2').jiraOnly.map((i) => i.key)).toEqual(['ABC-2'])
    expect(filterComparison(comparison(), '  ')).toEqual(comparison())
  })

  it('puts issues marked Done but not merged first', () => {
    expect(sortJiraOnly([issue('ABC-10'), issue('ABC-9', 'indeterminate'), issue('ABC-2', 'done')]).map((i) => i.key)).toEqual(['ABC-2', 'ABC-9', 'ABC-10'])
  })

  it('says where a merged issue is planned instead', () => {
    expect(elsewhereLabel(null)).toBe('Not found in Jira')
    expect(elsewhereLabel('unknown')).toBe('Not checked in Jira')
    expect(elsewhereLabel({ key: 'ABC-5', summary: '', status: '', url: '', fixVersions: [] })).toBe('No fix version in Jira')
    expect(
      elsewhereLabel({ key: 'ABC-5', summary: '', status: '', url: '', fixVersions: [{ id: '1', name: '1.5.0', released: false, releaseDate: null }] }),
    ).toBe('Fix version: 1.5.0')
  })
})
