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

  const searches: string[] = []
  app.get('/rest/api/2/myself', (_req, res) => void res.json({ displayName: 'Release Bot' }))
  app.get('/rest/api/2/project/:key', (req, res) =>
    req.params.key === 'ABC' ? void res.json({ key: 'ABC', name: 'Alpha Product' }) : void res.status(404).end(),
  )
  app.get('/rest/api/2/project/:key/versions', (req, res) => (req.params.key === 'ABC' ? void res.json(versions) : void res.status(404).end()))
  // One issue with its fix versions; ABC-1…150 are in 1.4.0, ABC-42 also shipped in 1.3.0.
  const versionRef = (id: string) => {
    const v = versions.find((x) => x.id === id)!
    return { id: v.id, name: v.name, released: v.released, ...(v.releaseDate ? { releaseDate: v.releaseDate } : {}) }
  }
  const login = {
    key: 'ABC-42',
    fields: {
      summary: 'Login times out behind the SSO proxy',
      issuetype: { name: 'Bug' },
      status: { name: 'Done', statusCategory: { key: 'done' } },
      assignee: { displayName: 'Dev Person' },
      fixVersions: [versionRef('10000')],
    },
  }
  app.get('/rest/api/2/issue/:key', (req, res) => {
    if (req.params.key === 'ABC-42') return void res.json(login)
    const n = Number(/^ABC-(\d+)$/.exec(req.params.key)?.[1])
    if (n > 150 && n <= 160) {
      return void res.json({
        key: req.params.key,
        fields: { summary: `Later work ${n}`, issuetype: { name: 'Story' }, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, fixVersions: [versionRef('10002')] },
      })
    }
    if (!n || n > 150) return void res.status(404).json({ errorMessages: ['Issue does not exist'] })
    const issue = issues('10001')[n - 1]!
    res.json({ ...issue, fields: { ...issue.fields, fixVersions: [versionRef('10001')] } })
  })
  // Full-text search ("text ~") finds the login bug.
  const textSearch = (jql: string) => (/text ~ "[^"]*login[^"]*"/i.test(jql) ? [login] : [])
  app.use((req, _res, next) => {
    const jql = String(req.body?.jql ?? req.query.jql ?? '')
    if (jql.includes('text ~')) searches.push(jql)
    next()
  })

  // Cloud: token pagination.
  app.post('/rest/api/3/search/jql', (req, res) => {
    if (req.body.jql.includes('text ~')) return void res.json({ issues: textSearch(req.body.jql), isLast: true })
    const all = issues(versionOf(req.body.jql))
    const start = req.body.nextPageToken ? Number(req.body.nextPageToken) : 0
    const page = all.slice(start, start + 100)
    const next = start + 100 < all.length ? String(start + 100) : undefined
    res.json({ issues: page, ...(next ? { nextPageToken: next, isLast: false } : { isLast: true }) })
  })
  // Server / Data Center: offset pagination.
  app.get('/rest/api/2/search', (req, res) => {
    if (String(req.query.jql).includes('text ~')) return void res.json({ issues: textSearch(String(req.query.jql)), total: 1, startAt: 0 })
    const all = issues(versionOf(String(req.query.jql)))
    const startAt = Number(req.query.startAt ?? 0)
    res.json({ issues: all.slice(startAt, startAt + 100), total: all.length, startAt, maxResults: 100 })
  })
  return { ...(await listen(app, https)), searches }
}

export const AI = { key: 'ai-app-key', secret: 'ai-app-secret', clientId: 'rt-client', clientSecret: 'rt-client-secret', project: 'acme-gen-ai' }

/**
 * Fake company AI gateway. Requires the app key + secret headers; answers in
 * Gemini or OpenAI format and records each request for inspection.
 */
export async function fakeAi() {
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  const requests: { path: string; body: any; headers: Record<string, string | undefined> }[] = []
  // Apigee-style OAuth: client credentials (Basic header or form fields) → bearer token.
  let issued = 0
  let validToken = ''
  let flaky = 0
  const tokenRequests: Record<string, string>[] = []
  app.post('/oauth/token', express.urlencoded({ extended: false }), (req, res) => {
    tokenRequests.push({ ...req.body })
    const b = basic(req) ?? [req.body.client_id, req.body.client_secret]
    if (req.body.grant_type !== 'client_credentials' || b[0] !== AI.clientId || b[1] !== AI.clientSecret) {
      return void res.status(401).json({ error: 'invalid_client', error_description: 'Client credentials are invalid' })
    }
    validToken = `token-${++issued}`
    res.json({ access_token: validToken, token_type: 'Bearer', expires_in: '3599' })
  })
  app.post(`/v1/projects/${AI.project}/locations/europe-west1/publishers/google/models/:model`, (req, res) => {
    requests.push({ path: req.path, body: req.body, headers: { authorization: req.get('authorization') } })
    if (req.get('authorization') !== `Bearer ${validToken}`) return void res.status(401).json({ error: { message: 'Invalid access token' } })
    if (req.body.generationConfig) return void res.status(400).json({ error: { message: 'Unknown field generationConfig' } })
    if (req.params.model === 'flaky:streamGenerateContent' && flaky++ % 2 === 0) {
      return void res.status(500).json({ error: 'ErrorResponseCode', message: 'Backend temporarily unavailable' })
    }
    if (req.params.model?.startsWith('java-only:') && !req.get('user-agent')?.startsWith('Java/')) {
      return void res.status(500).json({ error: 'Internal Server Error', message: 'ErrorResponseCode' })
    }
    if (req.params.model?.startsWith('java-only:')) {
      res.type('text/event-stream')
      return void res.send(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })}\n\n`)
    }
    if (req.params.model?.startsWith('broken:')) {
      return void res.status(500).json({ fault: { faultstring: 'Quota exceeded', detail: { errorcode: 'policies.ratelimit.QuotaViolation' } } })
    }
    if (req.params.model === 'flaky:streamGenerateContent') {
      res.type('text/event-stream')
      return void res.send(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Second try worked.' }] } }] })}\n\n`)
    }
    if (req.params.model === 'gemini-2.5-pro:generateContent') {
      return void res.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: 'Vertex says hi.' }] } }] })
    }
    if (req.params.model === 'gemini-2.5-pro:streamGenerateContent' && req.query.alt === 'sse') {
      const chunk = (parts: object[]) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] })}\r\n\r\n`
      res.type('text/event-stream')
      return void res.send(chunk([{ text: 'thinking…', thought: true }]) + chunk([{ text: 'Vertex ' }]) + chunk([{ text: 'says hi.' }]))
    }
    res.status(404).json({ error: { message: 'model not found' } })
  })
  app.use((req, res) => {
    requests.push({ path: req.path, body: req.body, headers: { key: req.get('x-app-key'), secret: req.get('x-app-secret') } })
    // Signed in with an OAuth token but no such route: 404, like an API gateway.
    if (req.get('authorization')?.startsWith('Bearer token-')) return void res.status(404).json({ error: { message: `Unable to identify proxy for ${req.path}` } })
    if (req.get('x-app-key') !== AI.key || req.get('x-app-secret') !== AI.secret) {
      return void res.status(401).json({ error: { message: 'invalid app credentials' } })
    }
    if (req.path === '/v1beta/models/gemini-test:generateContent') {
      return void res.json({ candidates: [{ content: { parts: [{ text: 'ABC-7 shipped in ' }, { text: '1.4.0.' }] } }] })
    }
    if (req.path === '/openai/chat/completions') return void res.json({ choices: [{ message: { content: 'From OpenAI format.' } }] })
    res.status(404).json({ error: { message: `no route ${req.path}` } })
  })
  return {
    ...(await listen(app)),
    requests,
    tokenRequests,
    get tokensIssued() {
      return issued
    },
    /** Invalidate the current token (the next call gets 401). */
    revokeToken() {
      validToken = 'revoked'
    },
  }
}

export const JENKINS = { user: 'ci-bot', token: 'jenkins-api-token' }

export interface FakeBuild {
  number: number
  result: string | null
  building: boolean
  artifacts?: { relativePath: string }[]
  /** Pipeline "build" steps: [job, build number or null while queued]. */
  downstream?: [string, number | null][]
  /** Parameterized Trigger plugin: [job, number]. */
  triggered?: [string, number][]
  /** Console log as Jenkins' progressiveHtml. */
  consoleHtml?: string
}

export async function fakeJenkins() {
  const app = express()
  const jobs = new Map<string, FakeBuild[]>([
    ['platform/integration-tests', [{ number: 41, result: 'FAILURE', building: false }]],
    [
      'platform/hit-suite',
      [{ number: 7, result: 'SUCCESS', building: false, artifacts: [{ relativePath: 'reports/hit.html' }], triggered: [['platform/report-publisher', 2]] }],
    ],
    ['platform/report-publisher', [{ number: 2, result: 'SUCCESS', building: false }]],
    // Test jobs run during the Automated jobs step.
    ['perf/load-test', [{ number: 8, result: 'SUCCESS', building: false, artifacts: [{ relativePath: 'reports/load.html' }] }]],
    ['perf/longevity', [{ number: 20, result: null, building: true }]],
    ['platform/deploy', []],
    // A running pipeline that started three jobs (one still waiting in the queue).
    [
      'release/orchestrator',
      [{ number: 5, result: null, building: true, downstream: [['platform/integration-tests', 41], ['platform/hit-suite', 7], ['platform/deploy', null]] }],
    ],
    // An old freestyle job: its downstream builds only show in the console log.
    [
      'legacy/umbrella',
      [
        {
          number: 3,
          result: 'FAILURE',
          building: false,
          consoleHtml: [
            'Started by user Ci Bot',
            "Triggering a new build of <a href='/job/platform/job/report-publisher/' class='model-link'>platform » report-publisher</a>",
            "<a href='/job/platform/job/report-publisher/2/' class='model-link'>platform » report-publisher #2</a> completed. Result was SUCCESS",
            "Unrelated link <a href='/job/platform/job/hit-suite/7/'>hit-suite #7</a>",
            'Finished: FAILURE',
          ].join('\n'),
        },
      ],
    ],
  ])
  const triggered: { job: string; params: Record<string, string> }[] = []
  app.use((req, res, next) => {
    const b = basic(req)
    if (!b || b[0] !== JENKINS.user || b[1] !== JENKINS.token) return void res.status(401).end()
    res.set('X-Jenkins', '2.462')
    next()
  })
  app.get('/api/json', (_req, res) => void res.json({ mode: 'NORMAL' }))
  // One build: /job/a/job/b/42/api/json (or lastBuild) and its console log.
  app.get(/^((?:\/job\/[^/]+)+)\/(\d+|lastBuild)\/(api\/json|logText\/progressiveHtml)$/, (req, res) => {
    const [, jobPart, which, what] = /^((?:\/job\/[^/]+)+)\/(\d+|lastBuild)\/(api\/json|logText\/progressiveHtml)$/.exec(req.path)!
    const path = jobPart!.split('/job/').filter(Boolean).map(decodeURIComponent).join('/')
    const builds = jobs.get(path)
    const b = which === 'lastBuild' ? builds?.at(-1) : builds?.find((x) => x.number === Number(which))
    if (!b) return void res.status(404).end()
    const origin = `${req.protocol}://${req.get('host')}`
    if (what !== 'api/json') return void res.type('text/html').send(b.consoleHtml ?? 'Started by user Ci Bot\nFinished: SUCCESS')
    res.json({
      number: b.number,
      result: b.result,
      building: b.building,
      url: `${origin}${jobPart}/${b.number}/`,
      // Running builds started 12 minutes ago; test jobs usually take 30 minutes.
      timestamp: b.building ? Date.now() - 12 * 60_000 : 1_900_000_000_000,
      duration: b.building ? 0 : 61_000,
      estimatedDuration: path.startsWith('perf/') ? 30 * 60_000 : 120_000,
      fullDisplayName: `${path.split('/').join(' » ')} #${b.number}`,
      artifacts: b.artifacts ?? [],
      actions: [
        { _class: 'hudson.model.CauseAction' },
        b.downstream ? { downstreamBuilds: b.downstream.map(([jobFullName, buildNumber]) => ({ jobFullName, buildNumber })) } : {},
        b.triggered
          ? { triggeredBuilds: b.triggered.map(([job, number]) => ({ number, url: `${origin}/job/${job.split('/').join('/job/')}/${number}/` })) }
          : {},
      ],
    })
  })
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

export const GITHUB = { token: 'ghp_fake_token' }

/**
 * Fake GitHub API: repo acme/app whose release/1.4.0 branch, compared with
 * release/1.3.0, contains merged pull requests (merge and squash), a merge of
 * main, a branch merge for an issue planned in another version, and filler
 * commits (so the comparison spans two pages).
 */
export async function fakeGitHub() {
  const app = express()
  const calls: string[] = []
  app.use((req, res, next) => {
    calls.push(req.originalUrl)
    // Serve the Enterprise API path (/api/v3/…) like GitHub Enterprise Server.
    if (req.url.startsWith('/api/v3/')) req.url = req.url.slice('/api/v3'.length)
    if (req.get('authorization') !== `Bearer ${GITHUB.token}`) return void res.status(401).json({ message: 'Bad credentials' })
    next()
  })
  const commit = (sha: string, message: string, parents = 1, login = 'maya') => ({
    sha: sha.padEnd(40, '0'),
    html_url: `https://github.example/acme/app/commit/${sha}`,
    parents: Array.from({ length: parents }, () => ({})),
    author: { login },
    commit: { message, author: { name: login, date: '2030-02-01T10:00:00Z' } },
  })
  const releaseCommits = [
    commit('a1', 'Fix review comments'),
    commit('a2', 'Merge pull request #12 from acme/feature/abc-1-sso\n\nLogin with SSO', 2),
    commit('b1', 'ABC-2 Faster search (#13)'),
    commit('c1', 'Bump dependencies (#14)', 1, 'dependabot'),
    commit('d1', "Merge branch 'main' into release/1.4.0", 2),
    commit('e1', "Merge branch 'feature/ABC-155-export' into release/1.4.0", 2),
    commit('f1', 'ABC-999 cleanup'),
    ...Array.from({ length: 105 }, (_, i) => commit(`f${String(i).padStart(3, '0')}`, `Refactor step ${i}`)),
  ]
  const pulls: Record<number, object> = {
    12: { number: 12, title: 'Login with SSO', html_url: 'https://github.example/acme/app/pull/12', merged_at: '2030-02-01T10:00:00Z', head: { ref: 'feature/abc-1-sso' }, user: { login: 'maya' } },
    13: { number: 13, title: 'ABC-2 Faster search', html_url: 'https://github.example/acme/app/pull/13', merged_at: '2030-02-02T10:00:00Z', head: { ref: 'search' }, user: { login: 'omar' } },
    14: { number: 14, title: 'Bump dependencies', html_url: 'https://github.example/acme/app/pull/14', merged_at: '2030-02-03T10:00:00Z', head: { ref: 'dependabot/npm' }, user: { login: 'dependabot' } },
  }
  app.get('/user', (_req, res) => void res.json({ login: 'release-bot' }))
  app.get('/repos/:owner/:repo', (req, res) =>
    `${req.params.owner}/${req.params.repo}` === 'acme/app' ? void res.json({ full_name: 'acme/app', default_branch: 'main' }) : void res.status(404).json({ message: 'Not Found' }),
  )
  app.get('/repos/:owner/:repo/pulls/:n', (req, res) => {
    const p = pulls[Number(req.params.n)]
    return p ? void res.json(p) : void res.status(404).json({ message: 'Not Found' })
  })
  // base...head; refs may contain slashes.
  app.get(/^\/repos\/acme\/app\/compare\/(.+)$/, (req, res) => {
    const [base, head] = decodeURIComponent(req.path.replace('/repos/acme/app/compare/', '')).split('...')
    if (base !== 'release/1.3.0' || head !== 'release/1.4.0') return void res.status(404).json({ message: 'Not Found' })
    const per = Number(req.query.per_page ?? 250)
    const page = Number(req.query.page ?? 1)
    res.json({
      total_commits: releaseCommits.length,
      html_url: `https://github.example/acme/app/compare/${base}...${head}`,
      commits: releaseCommits.slice((page - 1) * per, page * per),
    })
  })
  return { ...(await listen(app)), calls }
}

/** Fake Teams Workflows webhook: records the cards; can be told to fail. */
export async function fakeTeams() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  const cards: any[] = []
  let failNext = 0
  app.post('/workflows/release-tracker', (req, res) => {
    if (failNext > 0) {
      failNext--
      return void res.status(500).json({ error: { message: 'Flow run failed' } })
    }
    cards.push(req.body.attachments?.[0]?.content)
    res.status(202).end()
  })
  const server = await listen(app)
  return {
    ...server,
    webhook: `${server.url}/workflows/release-tracker`,
    cards,
    /** All text of a card, joined (for assertions). */
    textOf: (card: any) => JSON.stringify(card?.body ?? []),
    failNextPosts(n: number) {
      failNext = n
    },
  }
}
