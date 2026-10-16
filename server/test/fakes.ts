import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import express, { type Request } from 'express'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
/** The fake company root CA (PEM) that signed the HTTPS fakes' certificate. */
export const COMPANY_CA = fixture('ca.pem')

/**
 * Minimal fake Jira and Jenkins servers for the integration tests. They check
 * credentials the same way the real ones do and paginate like the real APIs.
 */

function basic(req: Request): [string, string] | null {
  const h = req.get('authorization') ?? ''
  if (!h.startsWith('Basic ')) return null
  const [u, ...p] = Buffer.from(h.slice(6), 'base64').toString().split(':')
  return [u ?? '', p.join(':')]
}

async function listen(app: express.Express, https = false) {
  // HTTPS mode serves a certificate signed by a private "company" CA and sends
  // the whole chain incl. the root, like corporate servers that trigger
  // SELF_SIGNED_CERT_IN_CHAIN.
  const server = https ? createServer({ cert: fixture('server-chain.pem'), key: fixture('server.key') }, app).listen(0) : app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const port = (server.address() as AddressInfo).port
  return { url: https ? `https://localhost:${port}` : `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) }
}

export const JIRA = { email: 'bot@example.com', token: 'jira-cloud-token', pat: 'jira-server-pat' }

export async function fakeJira({ https = false } = {}) {
  const app = express()
  app.use(express.json())
  const ok = (req: Request) => {
    const b = basic(req)
    return (b && b[0] === JIRA.email && b[1] === JIRA.token) || req.get('authorization') === `Bearer ${JIRA.pat}`
  }
  app.use((req, res, next) => (ok(req) ? next() : res.status(401).json({ errorMessages: ['Unauthorized'] })))

  const versions = [
    { id: '10001', name: '1.4.0', released: false, archived: false, releaseDate: '2030-03-01', description: 'Search revamp' },
    { id: '10002', name: '1.5.0', released: false, archived: false },
    { id: '10000', name: '1.3.0', released: true, archived: false, releaseDate: '2029-12-01' },
  ]
  const types = ['Story', 'Bug', 'Task']
  const cats = ['new', 'indeterminate', 'done']
  // 150 issues in 1.4.0 (two pages), 2 in 1.5.0.
  const issues = (versionId: string) =>
    Array.from({ length: versionId === '10001' ? 150 : 2 }, (_, i) => ({
      key: `ABC-${i + 1}`,
      fields: {
        summary: `Issue ${i + 1}`,
        issuetype: { name: types[i % 3] },
        status: { name: ['To Do', 'In Progress', 'Done'][i % 3], statusCategory: { key: cats[i % 3] } },
        priority: { name: 'Major' },
        assignee: i % 2 ? { displayName: 'Dev Person' } : null,
      },
    }))
  const versionOf = (jql: string) => /fixVersion = (\d+)/.exec(jql)?.[1] ?? ''

  app.get('/rest/api/2/myself', (_req, res) => void res.json({ displayName: 'Release Bot' }))
  app.get('/rest/api/2/project/:key', (req, res) =>
    req.params.key === 'ABC' ? void res.json({ key: 'ABC', name: 'Alpha Product' }) : void res.status(404).end(),
  )
  app.get('/rest/api/2/project/:key/versions', (req, res) => (req.params.key === 'ABC' ? void res.json(versions) : void res.status(404).end()))
  // Cloud: token pagination.
  app.post('/rest/api/3/search/jql', (req, res) => {
    const all = issues(versionOf(req.body.jql))
    const start = req.body.nextPageToken ? Number(req.body.nextPageToken) : 0
    const page = all.slice(start, start + 100)
    const next = start + 100 < all.length ? String(start + 100) : undefined
    res.json({ issues: page, ...(next ? { nextPageToken: next, isLast: false } : { isLast: true }) })
  })
  // Server / Data Center: offset pagination.
  app.get('/rest/api/2/search', (req, res) => {
    const all = issues(versionOf(String(req.query.jql)))
    const startAt = Number(req.query.startAt ?? 0)
    res.json({ issues: all.slice(startAt, startAt + 100), total: all.length, startAt, maxResults: 100 })
  })
  return listen(app, https)
}

export const JENKINS = { user: 'ci-bot', token: 'jenkins-api-token' }

export interface FakeBuild {
  number: number
  result: string | null
  building: boolean
  artifacts?: { relativePath: string }[]
}

export async function fakeJenkins() {
  const app = express()
  const jobs = new Map<string, FakeBuild[]>([
    ['platform/integration-tests', [{ number: 41, result: 'FAILURE', building: false }]],
    ['platform/hit-suite', [{ number: 7, result: 'SUCCESS', building: false, artifacts: [{ relativePath: 'reports/hit.html' }] }]],
  ])
  const triggered: { job: string; params: Record<string, string> }[] = []
  app.use((req, res, next) => {
    const b = basic(req)
    if (!b || b[0] !== JENKINS.user || b[1] !== JENKINS.token) return void res.status(401).end()
    res.set('X-Jenkins', '2.462')
    next()
  })
  app.get('/api/json', (_req, res) => void res.json({ mode: 'NORMAL' }))
  // /job/a/job/b/api/json  and  POST /job/a/job/b/buildWithParameters
  app.use((req, res) => {
    const m = /^((?:\/job\/[^/]+)+)\/(api\/json|build|buildWithParameters)$/.exec(req.path)
    if (!m) return void res.status(404).end()
    const path = m[1]!.split('/job/').filter(Boolean).map(decodeURIComponent).join('/')
    const builds = jobs.get(path)
    if (!builds) return void res.status(404).end()
    const base = `${req.protocol}://${req.get('host')}${m[1]}`
    if (m[2] === 'api/json') {
      return void res.json({
        builds: [...builds].reverse().map((b) => ({ ...b, url: `${base}/${b.number}/`, timestamp: 1_900_000_000_000, duration: 61_000 })),
      })
    }
    if (req.method !== 'POST') return void res.status(405).end()
    triggered.push({ job: path, params: Object.fromEntries(new URLSearchParams(req.url.split('?')[1] ?? '')) })
    builds.push({ number: (builds.at(-1)?.number ?? 0) + 1, result: null, building: true })
    res.status(201).set('Location', `${base}/queue/1/`).end()
  })
  const server = await listen(app)
  return {
    ...server,
    jobs,
    triggered,
    /** Finish the newest build of a job with a result. */
    finish(job: string, result: string) {
      const b = jobs.get(job)!.at(-1)!
      b.building = false
      b.result = result
    },
  }
}
