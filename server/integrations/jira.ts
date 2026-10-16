import { HttpError } from '../http/errors.js'
import { outboundJson } from './outbound.js'

export type JiraAuth = 'JIRA_CLOUD' | 'JIRA_SERVER'

export interface JiraConnection {
  baseUrl: string
  authType: JiraAuth
  /** Cloud: account email. Server/DC: unused. */
  username: string | null
  /** Cloud: API token. Server/DC: personal access token. */
  secret: string
  /** Company CA certificate(s) to trust, PEM. */
  ca?: string | null
}

export interface JiraVersion {
  id: string
  name: string
  released: boolean
  archived: boolean
  releaseDate: string | null
  description: string | null
}

export interface JiraIssue {
  key: string
  summary: string
  type: string
  status: string
  /** Jira's status category: new (to do), indeterminate (in progress), done. */
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown'
  priority: string | null
  assignee: string | null
  url: string
}

const SERVICE = 'Jira'
export const MAX_ISSUES = 1000
const FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee']

export const isJiraProjectKey = (key: string) => /^[A-Z][A-Z0-9_]{1,19}$/.test(key)

function headers(c: JiraConnection): Record<string, string> {
  if (c.authType === 'JIRA_CLOUD') {
    if (!c.username) throw new HttpError(422, 'Jira Cloud needs the account email.', 'invalid')
    return { authorization: `Basic ${Buffer.from(`${c.username}:${c.secret}`).toString('base64')}` }
  }
  return { authorization: `Bearer ${c.secret}` }
}

/** Verifies credentials; returns the Jira account's display name. */
export async function jiraWhoAmI(c: JiraConnection): Promise<string> {
  const me = await outboundJson<{ displayName?: string; name?: string }>(`${c.baseUrl}/rest/api/2/myself`, SERVICE, {
    headers: headers(c),
    ca: c.ca,
  })
  return me.displayName ?? me.name ?? 'unknown user'
}

export async function jiraProjectName(c: JiraConnection, projectKey: string): Promise<string> {
  const p = await outboundJson<{ name?: string }>(`${c.baseUrl}/rest/api/2/project/${encodeURIComponent(projectKey)}`, SERVICE, {
    headers: headers(c),
    ca: c.ca,
  })
  return p.name ?? projectKey
}

export async function jiraVersions(c: JiraConnection, projectKey: string): Promise<JiraVersion[]> {
  const raw = await outboundJson<Array<Record<string, unknown>>>(
    `${c.baseUrl}/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`,
    SERVICE,
    { headers: headers(c), ca: c.ca },
  )
  return raw.map((v) => ({
    id: String(v.id),
    name: String(v.name ?? ''),
    released: v.released === true,
    archived: v.archived === true,
    releaseDate: typeof v.releaseDate === 'string' ? v.releaseDate : null,
    description: typeof v.description === 'string' && v.description ? v.description : null,
  }))
}

interface RawIssue {
  key: string
  fields: {
    summary?: string
    status?: { name?: string; statusCategory?: { key?: string } }
    issuetype?: { name?: string }
    priority?: { name?: string } | null
    assignee?: { displayName?: string } | null
  }
}

function mapIssue(c: JiraConnection, i: RawIssue): JiraIssue {
  const cat = i.fields.status?.statusCategory?.key
  return {
    key: i.key,
    summary: i.fields.summary ?? '',
    type: i.fields.issuetype?.name ?? 'Issue',
    status: i.fields.status?.name ?? 'Unknown',
    statusCategory: cat === 'new' || cat === 'indeterminate' || cat === 'done' ? cat : 'unknown',
    priority: i.fields.priority?.name ?? null,
    assignee: i.fields.assignee?.displayName ?? null,
    url: `${c.baseUrl}/browse/${encodeURIComponent(i.key)}`,
  }
}

/** All issues whose fix version is `versionId` (tasks, bugs, stories…). */
export async function jiraVersionIssues(c: JiraConnection, versionId: string): Promise<{ issues: JiraIssue[]; truncated: boolean }> {
  if (!/^\d{1,20}$/.test(versionId)) throw new HttpError(422, 'Invalid Jira version id.', 'invalid')
  const jql = `fixVersion = ${versionId} ORDER BY issuetype ASC, priority DESC, key ASC`
  const issues: JiraIssue[] = []

  if (c.authType === 'JIRA_CLOUD') {
    // Jira Cloud's current search API (token pagination).
    let nextPageToken: string | undefined
    do {
      const page = await outboundJson<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean }>(
        `${c.baseUrl}/rest/api/3/search/jql`,
        SERVICE,
        {
          method: 'POST',
          headers: { ...headers(c), 'content-type': 'application/json' },
          ca: c.ca,
          body: JSON.stringify({ jql, fields: FIELDS, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }),
        },
      )
      issues.push(...page.issues.map((i) => mapIssue(c, i)))
      nextPageToken = page.isLast === true ? undefined : page.nextPageToken
    } while (nextPageToken && issues.length < MAX_ISSUES)
  } else {
    // Server / Data Center: offset pagination.
    let startAt = 0
    for (;;) {
      const params = new URLSearchParams({ jql, fields: FIELDS.join(','), startAt: String(startAt), maxResults: '100' })
      const page = await outboundJson<{ issues: RawIssue[]; total: number }>(`${c.baseUrl}/rest/api/2/search?${params}`, SERVICE, {
        headers: headers(c),
        ca: c.ca,
      })
      issues.push(...page.issues.map((i) => mapIssue(c, i)))
      startAt += page.issues.length
      if (page.issues.length === 0 || startAt >= page.total || issues.length >= MAX_ISSUES) break
    }
  }
  return { issues: issues.slice(0, MAX_ISSUES), truncated: issues.length >= MAX_ISSUES }
}

export interface JiraIssueVersions {
  key: string
  summary: string
  type: string
  status: string
  statusCategory: JiraIssue['statusCategory']
  assignee: string | null
  url: string
  fixVersions: { id: string; name: string; released: boolean; releaseDate: string | null }[]
}

type RawVersionedIssue = RawIssue & { fields: RawIssue['fields'] & { fixVersions?: Array<Record<string, unknown>> } }

function mapVersionedIssue(c: JiraConnection, raw: RawVersionedIssue): JiraIssueVersions {
  const issue = mapIssue(c, raw)
  return {
    key: issue.key,
    summary: issue.summary,
    type: issue.type,
    status: issue.status,
    statusCategory: issue.statusCategory,
    assignee: issue.assignee,
    url: issue.url,
    fixVersions: (raw.fields.fixVersions ?? []).map((v) => ({
      id: String(v.id),
      name: String(v.name ?? ''),
      released: v.released === true,
      releaseDate: typeof v.releaseDate === 'string' ? v.releaseDate : null,
    })),
  }
}

/**
 * Up to `limit` issues of the project whose text matches the words (Jira's
 * own full-text search), with their fix versions. Words are reduced to
 * letters/digits, so nothing can change the JQL beyond the search text.
 */
export async function jiraTextSearch(c: JiraConnection, projectKey: string, words: string[], limit = 15): Promise<JiraIssueVersions[]> {
  const terms = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length >= 2).slice(0, 8)
  if (!terms.length || !isJiraProjectKey(projectKey)) return []
  const jql = `project = "${projectKey}" AND text ~ "${terms.join(' ')}" ORDER BY updated DESC`
  const fields = [...FIELDS, 'fixVersions']
  let raw: RawVersionedIssue[]
  if (c.authType === 'JIRA_CLOUD') {
    raw = (
      await outboundJson<{ issues: RawVersionedIssue[] }>(`${c.baseUrl}/rest/api/3/search/jql`, SERVICE, {
        method: 'POST',
        headers: { ...headers(c), 'content-type': 'application/json' },
        ca: c.ca,
        body: JSON.stringify({ jql, fields, maxResults: limit }),
      })
    ).issues
  } else {
    const params = new URLSearchParams({ jql, fields: fields.join(','), maxResults: String(limit) })
    raw = (await outboundJson<{ issues: RawVersionedIssue[] }>(`${c.baseUrl}/rest/api/2/search?${params}`, SERVICE, { headers: headers(c), ca: c.ca }))
      .issues
  }
  return raw.slice(0, limit).map((i) => mapVersionedIssue(c, i))
}

/** One issue with its fix versions ("which version shipped ABC-123?"). Null if it doesn't exist. */
export async function jiraIssueVersions(c: JiraConnection, key: string): Promise<JiraIssueVersions | null> {
  if (!/^[A-Z][A-Z0-9_]{1,19}-\d{1,9}$/.test(key)) return null
  const fields = 'summary,status,issuetype,assignee,fixVersions'
  try {
    const raw = await outboundJson<RawVersionedIssue>(`${c.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}?fields=${fields}`, SERVICE, {
      headers: headers(c),
      ca: c.ca,
    })
    return mapVersionedIssue(c, raw)
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null
    throw err
  }
}
