import { describe, expect, it } from 'vitest'
import { compareWithJira, findBranchKeys, findIssueKeys, toChanges } from './code-compare.js'
import type { GitCommit, PullRequest } from './github.js'
import type { JiraIssue } from './jira.js'

const commit = (sha: string, message: string, parents = 1): GitCommit => ({
  sha: sha.padEnd(40, '0'),
  message,
  author: 'dev',
  date: '2030-01-01T00:00:00Z',
  url: `https://github.com/acme/app/commit/${sha}`,
  parents,
})
const issue = (key: string): JiraIssue => ({
  key,
  summary: `Summary of ${key}`,
  type: 'Story',
  status: 'Done',
  statusCategory: 'done',
  priority: null,
  assignee: null,
  url: `https://jira/browse/${key}`,
})

describe('findBranchKeys', () => {
  it('takes a key at the start of any part of the branch name, in any case', () => {
    expect(findBranchKeys('jdoe/fieldbug-812')).toEqual(['FIELDBUG-812'])
    expect(findBranchKeys('jdoe/ABC-12-login-page')).toEqual(['ABC-12'])
    expect(findBranchKeys('ABC-5')).toEqual(['ABC-5'])
    expect(findBranchKeys('jdoe/release-2')).toEqual([])
    expect(findBranchKeys('jdoe/fix-login')).toEqual([])
    expect(findBranchKeys('jdoe/utf-8-names')).toEqual([])
  })
})

describe('findIssueKeys', () => {
  it('finds the project key in any case, other keys only in upper case', () => {
    expect(findIssueKeys('feature/abc-12-login and ABC-7, also OPS-3', 'ABC')).toEqual(['ABC-12', 'ABC-7', 'OPS-3'])
    expect(findIssueKeys('ops-3 lower case other project', 'ABC')).toEqual([])
  })

  it('ignores look-alikes such as UTF-8 or SHA-256', () => {
    expect(findIssueKeys('Use UTF-8 and SHA-256, see RFC-7231 and CVE-2024', 'ABC')).toEqual([])
  })

  it('normalizes leading zeros', () => {
    expect(findIssueKeys('ABC-007', 'ABC')).toEqual(['ABC-7'])
  })
})

describe('toChanges + compareWithJira', () => {
  const pulls = new Map<number, PullRequest>([
    [12, { number: 12, title: 'Login with SSO', branch: 'feature/abc-1-sso', author: 'maya', url: 'https://github.com/acme/app/pull/12', mergedAt: null }],
  ])
  const commits = [
    commit('a1', 'Fix typo'), // inside PR #12's branch
    commit('a2', 'Merge pull request #12 from acme/feature/abc-1-sso\n\nLogin with SSO', 2),
    commit('b1', 'ABC-2 Faster search (#13)'), // squash merge
    commit('c1', 'Bump dependencies (#14)'), // PR without a key
    commit('d1', "Merge branch 'main' into release/1.4", 2), // sync
    commit('e1', "Merge branch 'feature/ABC-9-export' into release/1.4", 2), // ABC-9 not in Jira version
    commit('f1', 'OPS-5 hotfix for the deploy script'), // other project
    commit('g1', 'Merge pull request #12 from acme/feature/abc-1-sso\n\nLogin with SSO', 2), // same PR again (re-merge)
  ]
  const changes = toChanges('acme/app', commits, pulls, 'ABC')

  it('reads pull requests from merge and squash commits, once each', () => {
    const prs = changes.filter((c) => c.kind === 'pr')
    expect(prs.map((p) => [p.ref, p.title, p.branch, p.keys])).toEqual([
      ['#12', 'Login with SSO', 'feature/abc-1-sso', ['ABC-1']],
      ['#13', 'ABC-2 Faster search', null, ['ABC-2']],
      ['#14', 'Bump dependencies', null, []],
    ])
    expect(prs[0]!.url).toBe('https://github.com/acme/app/pull/12')
  })

  it('sorts changes against the Jira version', () => {
    const result = compareWithJira(changes, [issue('ABC-1'), issue('ABC-2'), issue('ABC-3')])
    expect(result.matched.map((m) => [m.issue.key, m.changes.map((c) => c.ref)])).toEqual([
      ['ABC-1', ['#12']],
      ['ABC-2', ['#13']],
    ])
    expect(result.jiraOnly.map((i) => i.key)).toEqual(['ABC-3'])
    expect(result.codeOnly.map((c) => [c.key, c.changes.map((x) => x.ref)])).toEqual([
      ['ABC-9', ['e100000']],
      ['OPS-5', ['f100000']],
    ])
    expect(result.noKey.map((c) => c.ref)).toEqual(['#14'])
    expect(result.otherCommits.map((c) => c.title)).toEqual(['Fix typo'])
    expect(result.syncMerges.map((c) => c.title)).toEqual(["Merge branch 'main' into release/1.4"])
  })

  it("reads the team's format: Merge pull request #N from <name>/<jira id>", () => {
    const own = toChanges(
      'acme/app',
      [
        commit('h1', 'Merge pull request #45 from jdoe/ABC-77\n\nAdd export', 2),
        commit('h2', 'Merge pull request #46 from jdoe/fieldbug-812\n\nCrash on start', 2), // other Jira project, lower case
        commit('h3', 'Merge pull request #47 from mmaya/abc-78-story-title\n\nNew screen', 2),
        commit('h4', 'Merge pull request #48 from jdoe/release-2\n\nBack-merge', 2),
      ],
      new Map(), // pull request details unavailable: the commit alone is enough
      'ABC',
    )
    expect(own.map((c) => [c.ref, c.branch, c.title, c.keys])).toEqual([
      ['#45', 'ABC-77', 'Add export', ['ABC-77']],
      ['#46', 'fieldbug-812', 'Crash on start', ['FIELDBUG-812']],
      ['#47', 'abc-78-story-title', 'New screen', ['ABC-78']],
      ['#48', 'release-2', 'Back-merge', []],
    ])
  })
})
