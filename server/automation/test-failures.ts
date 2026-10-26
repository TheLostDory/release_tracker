import { jiraIssueRaw, jiraSearchRaw, type JiraConnection, type RawLinkedIssue, type RawSearchIssue } from '../integrations/jira.js'
import { keysInTestName, normalizeName, searchPhrase } from './test-report.js'

/**
 * Jira bugs (and field bugs) for failed test cases. A bug counts when:
 *   - it mentions the test's name (summary, description or labels);
 *   - it's linked to the test case's own Jira issue (Xray, Zephyr…);
 *   - its key is in the test's name (test_login_ABC_123).
 */
export interface FoundBug {
  key: string
  summary: string
  type: string
  status: string
  statusCategory: string
  url: string
  /** Why it matched: "mentions the test", "key in the test name", "linked to test case ABC-5". */
  via: string
}

export interface FailedTest {
  name: string
  bugs: FoundBug[]
}

const FIELDS = ['summary', 'issuetype', 'status', 'labels', 'issuelinks', 'description']
const BATCH = 5
const MAX_TESTS = 50
const MAX_KEYS = 30

const isBug = (type: string | undefined, bugTypes: string[]) => !!type && bugTypes.some((t) => t.toLowerCase() === type.toLowerCase())

function bugOf(c: JiraConnection, i: RawLinkedIssue | RawSearchIssue, via: string): FoundBug {
  return {
    key: i.key,
    summary: i.fields?.summary ?? '',
    type: i.fields?.issuetype?.name ?? 'Bug',
    status: i.fields?.status?.name ?? 'Unknown',
    statusCategory: i.fields?.status?.statusCategory?.key ?? 'unknown',
    url: `${c.baseUrl}/browse/${encodeURIComponent(i.key)}`,
    via,
  }
}

/** Bugs linked to an issue (a test case). */
function linkedBugs(c: JiraConnection, issue: RawSearchIssue, bugTypes: string[]): FoundBug[] {
  return (issue.fields.issuelinks ?? [])
    .map((l) => l.inwardIssue ?? l.outwardIssue)
    .filter((x): x is RawLinkedIssue => !!x && isBug(x.fields?.issuetype?.name, bugTypes))
    .map((x) => bugOf(c, x, `linked to test case ${issue.key}`))
}

/** Words of everything the issue says (summary, labels, description: plain or Jira Cloud's document format). */
const haystack = (i: RawSearchIssue) =>
  normalizeName([i.fields.summary ?? '', (i.fields.labels ?? []).join(' '), typeof i.fields.description === 'string' ? i.fields.description : JSON.stringify(i.fields.description ?? '')].join(' '))

/** Keeps a JQL phrase to words, so nothing in a test name can change the query. */
const phraseJql = (phrase: string) => `text ~ "\\"${phrase.replace(/[^a-z0-9 ]/g, ' ').trim()}\\""`

export async function findBugsForTests(
  c: JiraConnection,
  opts: { projectKey: string | null; bugTypes: string[]; allProjects: boolean },
  testNames: string[],
): Promise<{ tests: FailedTest[]; notes: string[] }> {
  const notes: string[] = []
  const names = testNames.slice(0, MAX_TESTS)
  if (testNames.length > names.length) notes.push(`Only the first ${MAX_TESTS} failed tests were looked up in Jira.`)
  const bugs = new Map<string, FoundBug[]>(names.map((n) => [n, []]))
  const add = (name: string, found: FoundBug[]) => {
    const list = bugs.get(name)!
    for (const b of found) if (!list.some((x) => x.key === b.key)) list.push(b)
  }

  // Keys written in the test names: the bug itself, or a test case with linked bugs.
  const keyed = names.flatMap((n) => keysInTestName(n, opts.projectKey).map((k) => ({ name: n, key: k })))
  const keys = [...new Set(keyed.map((k) => k.key))].slice(0, MAX_KEYS)
  const issues = new Map<string, RawSearchIssue | null>()
  for (const k of keys) issues.set(k, await jiraIssueRaw(c, k, FIELDS))
  for (const { name, key } of keyed) {
    const issue = issues.get(key)
    if (!issue) continue
    if (isBug(issue.fields.issuetype?.name, opts.bugTypes)) add(name, [bugOf(c, issue, 'key in the test name')])
    else add(name, linkedBugs(c, issue, opts.bugTypes))
  }

  // Issues mentioning the test names: bugs directly, or test cases with linked bugs.
  const scope = opts.allProjects || !opts.projectKey ? '' : `project = "${opts.projectKey}" AND `
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH).map((name) => ({ name, phrase: searchPhrase(name) })).filter((b) => b.phrase.length >= 3)
    if (!batch.length) continue
    const jql = `${scope}(${batch.map((b) => phraseJql(b.phrase)).join(' OR ')}) ORDER BY updated DESC`
    let found: RawSearchIssue[]
    try {
      found = await jiraSearchRaw(c, jql, FIELDS, 100)
    } catch (err) {
      notes.push(`Jira search failed for some tests: ${(err as Error).message}`)
      continue
    }
    for (const issue of found) {
      const words = haystack(issue)
      for (const b of batch) {
        // Jira's search is fuzzy: keep only issues that really contain the name.
        if (!words.includes(b.phrase) && !words.includes(normalizeName(b.name))) continue
        if (isBug(issue.fields.issuetype?.name, opts.bugTypes)) add(b.name, [bugOf(c, issue, 'mentions the test')])
        else add(b.name, linkedBugs(c, issue, opts.bugTypes))
      }
    }
  }

  return { tests: names.map((name) => ({ name, bugs: bugs.get(name)! })), notes }
}
