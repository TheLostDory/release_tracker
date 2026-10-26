import { jiraIssueRaw, jiraSearchRaw, type JiraConnection, type RawLinkedIssue, type RawSearchIssue } from '../integrations/jira.js'
import { keysInTestName, normalizeName, searchPhrase, type FailedTestRef } from './test-report.js'

/**
 * Jira bugs (and field bugs) for failed test cases. A bug counts when:
 *   - it mentions the test's script name or ID (summary, description,
 *     comments or labels), or the test's name when the report gives no script;
 *   - it's linked to the test case's own Jira issue (Xray, Zephyr…) that does;
 *   - its key is in the test's name or script (test_login_ABC_123).
 */
export interface FoundBug {
  key: string
  summary: string
  type: string
  status: string
  statusCategory: string
  url: string
  /** Why it matched: "mentions TC_101", "mentions the test", "key in the test name", "linked to test case ABC-5". */
  via: string
}

export interface FailedTest extends FailedTestRef {
  bugs: FoundBug[]
}

const FIELDS = ['summary', 'issuetype', 'status', 'labels', 'issuelinks', 'description', 'comment']
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
function linkedBugs(c: JiraConnection, issue: RawSearchIssue, bugTypes: string[], why = ''): FoundBug[] {
  return (issue.fields.issuelinks ?? [])
    .map((l) => l.inwardIssue ?? l.outwardIssue)
    .filter((x): x is RawLinkedIssue => !!x && isBug(x.fields?.issuetype?.name, bugTypes))
    .map((x) => bugOf(c, x, `linked to test case ${issue.key}${why}`))
}

/** Everything the issue says, lowercase (summary, labels, description and comments: plain or Jira Cloud's document format). */
const rawText = (i: RawSearchIssue) =>
  [i.fields.summary ?? '', (i.fields.labels ?? []).join(' '), typeof i.fields.description === 'string' ? i.fields.description : JSON.stringify(i.fields.description ?? ''), JSON.stringify(i.fields.comment ?? '')]
    .join(' ')
    .toLowerCase()

/** Words of everything the issue says. */
const haystack = (i: RawSearchIssue) => normalizeName(rawText(i))

/** Keeps a JQL phrase to words, so nothing in a test name can change the query. */
const phraseJql = (phrase: string) => `text ~ "\\"${phrase.replace(/[^a-z0-9 ]/g, ' ').trim()}\\""`

/** A script name / ID kept to the characters IDs use (TC_12345, LOGIN-7, checkout.flow). */
const cleanId = (id: string) => id.replace(/[^A-Za-z0-9_.\- ]/g, ' ').replace(/\s+/g, ' ').trim()

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether the text has the ID as a whole word: "TC_101" in "fails in TC_101", "tc-101" or "TC101"; not in "TC_1010". */
const hasId = (text: string, id: string) =>
  new RegExp(`(?<![a-z0-9])${id.toLowerCase().split(/[_.\- ]+/).filter(Boolean).map(escapeRe).join('[_.\\- ]?')}(?![a-z0-9])`).test(text)

interface Term {
  test: number
  text: string
  /** A script name / ID, matched as written; else words of the test's name. */
  exact: boolean
}

export async function findBugsForTests(
  c: JiraConnection,
  opts: { projectKey: string | null; bugTypes: string[]; allProjects: boolean },
  failedTests: FailedTestRef[],
): Promise<{ tests: FailedTest[]; notes: string[] }> {
  const notes: string[] = []
  const tests: FailedTest[] = failedTests.slice(0, MAX_TESTS).map((t) => ({ ...t, bugs: [] }))
  if (failedTests.length > tests.length) notes.push(`Only the first ${MAX_TESTS} failed tests were looked up in Jira.`)
  const add = (test: number, found: FoundBug[]) => {
    const list = tests[test]!.bugs
    for (const b of found) if (!list.some((x) => x.key === b.key)) list.push(b)
  }

  // Keys written in the test names or scripts: the bug itself, or a test case with linked bugs.
  const keyed = tests.flatMap((t, test) => [...new Set([t.name, ...t.ids].flatMap((n) => keysInTestName(n, opts.projectKey)))].map((key) => ({ test, key })))
  const keys = [...new Set(keyed.map((k) => k.key))].slice(0, MAX_KEYS)
  const issues = new Map<string, RawSearchIssue | null>()
  for (const k of keys) issues.set(k, await jiraIssueRaw(c, k, FIELDS))
  for (const { test, key } of keyed) {
    const issue = issues.get(key)
    if (!issue) continue
    if (isBug(issue.fields.issuetype?.name, opts.bugTypes)) add(test, [bugOf(c, issue, 'key in the test name')])
    else add(test, linkedBugs(c, issue, opts.bugTypes))
  }

  // Issues mentioning the scripts / IDs (or, without one, the test's name): bugs directly, or test cases with linked bugs.
  const terms: Term[] = tests
    .flatMap((t, test) => (t.ids.length ? t.ids.map((id) => ({ test, text: cleanId(id), exact: true })) : [{ test, text: searchPhrase(t.name), exact: false }]))
    .filter((t) => t.text.length >= 3)
  const scope = opts.allProjects || !opts.projectKey ? '' : `project = "${opts.projectKey}" AND `
  for (let i = 0; i < terms.length; i += BATCH) {
    const batch = terms.slice(i, i + BATCH)
    const jql = `${scope}(${batch.map((b) => (b.exact ? `text ~ "\\"${b.text}\\""` : phraseJql(b.text))).join(' OR ')}) ORDER BY updated DESC`
    let found: RawSearchIssue[]
    try {
      found = await jiraSearchRaw(c, jql, FIELDS, 100)
    } catch (err) {
      notes.push(`Jira search failed for some tests: ${(err as Error).message}`)
      continue
    }
    // Labels aren't in Jira's text search: IDs used as labels, asked apart (a label Jira doesn't know mustn't fail the rest).
    const labels = [...new Set(batch.filter((b) => b.exact && !b.text.includes(' ')).map((b) => b.text))]
    if (labels.length) {
      const byLabel = await jiraSearchRaw(c, `${scope}labels in (${labels.map((l) => `"${l}"`).join(', ')}) ORDER BY updated DESC`, FIELDS, 100).catch(() => [])
      for (const issue of byLabel) if (!found.some((x) => x.key === issue.key)) found.push(issue)
    }
    for (const issue of found) {
      const raw = rawText(issue)
      const words = haystack(issue)
      for (const b of batch) {
        // Jira's search is fuzzy: keep only issues that really contain the ID / name.
        const test = tests[b.test]!
        const has = b.exact ? hasId(raw, b.text) : words.includes(b.text) || words.includes(normalizeName(test.name))
        if (!has) continue
        if (isBug(issue.fields.issuetype?.name, opts.bugTypes)) add(b.test, [bugOf(c, issue, b.exact ? `mentions ${b.text}` : 'mentions the test')])
        else add(b.test, linkedBugs(c, issue, opts.bugTypes, b.exact ? `, which mentions ${b.text}` : ''))
      }
    }
  }

  return { tests, notes }
}
