import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AI, fakeAi, fakeJira, JIRA } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

/** The assistant: retrieval from tracker + Jira, sent to a fake AI gateway. */
describe.skipIf(remote)('assistant', () => {
  let plain: Awaited<ReturnType<typeof startServer>>
  let gemini: Awaited<ReturnType<typeof startServer>>
  let openai: Awaited<ReturnType<typeof startServer>>
  let wrongSecret: Awaited<ReturnType<typeof startServer>>
  let ai: Awaited<ReturnType<typeof fakeAi>>
  let jira: Awaited<ReturnType<typeof fakeJira>>
  let projectId: string
  const headers = JSON.stringify({ 'X-App-Key': '{key}', 'X-App-Secret': '{secret}' })
  const as = async (server: { base: string }, email = 'charbel@example.com') => {
    const c = client(server.base)
    await c.login(email)
    return c
  }
  const ask = (c: Awaited<ReturnType<typeof as>>, ...questions: string[]) =>
    c.post(`/api/projects/${projectId}/chat`, {
      messages: questions.flatMap((q, i) => (i ? [{ role: 'assistant', content: 'ok' }] : []).concat({ role: 'user', content: q })),
    })
  const lastSystem = () => ai.requests.at(-1)!.body.systemInstruction.parts[0].text as string

  beforeAll(async () => {
    ;[ai, jira] = await Promise.all([fakeAi(), fakeJira()])
    const env = { AI_BASE_URL: ai.url, AI_API_KEY: AI.key, AI_API_SECRET: AI.secret, AI_HEADERS: headers }
    ;[plain, gemini, openai, wrongSecret] = await Promise.all([
      startServer({ AI_BASE_URL: '' }),
      startServer({ ...env, AI_MODEL: 'gemini-test' }),
      startServer({ ...env, AI_FORMAT: 'openai', AI_PATH: '/openai/chat/completions' }),
      startServer({ ...env, AI_MODEL: 'gemini-test', AI_API_SECRET: 'nope' }),
    ])
    const c = await as(gemini)
    projectId = (await c.post('/api/projects', { name: `Assistant ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jira`, {
      authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: JIRA.token, projectKey: 'ABC',
    })
    await c.post(`/api/projects/${projectId}/jira/import`, { versionIds: ['10001'] })
    await c.post('/api/releases', { project_id: projectId, name: 'Hotfix', version: '1.4.1', planned_deployment_date: '2030-05-01' })
  })
  afterAll(async () => {
    await Promise.all([plain, gemini, openai, wrongSecret].map((s) => s?.stop()))
    await Promise.all([ai?.close(), jira?.close()])
  })

  it('is off unless the server is configured', async () => {
    const c = await as(plain)
    expect((await c.get('/api/chat/config')).body).toEqual({ enabled: false })
    const r = await ask(c, 'hi')
    expect(r.status).toBe(503)
    expect((await (await as(gemini)).get('/api/chat/config')).body).toEqual({ enabled: true })
  })

  it('answers which version an issue shipped in (Gemini format, key + secret headers)', async () => {
    const c = await as(gemini)
    const r = await ask(c, 'Which version was ABC-7 released in?')
    expect(r.status).toBe(200)
    expect(r.body.answer).toBe('ABC-7 shipped in 1.4.0.')
    expect(r.body.sources).toEqual([{ kind: 'jira_issue', label: 'ABC-7', url: `${jira.url}/browse/ABC-7` }])

    const req = ai.requests.at(-1)!
    expect(req.path).toBe('/v1beta/models/gemini-test:generateContent')
    expect(req.headers).toEqual({ key: AI.key, secret: AI.secret })
    expect(req.body.contents).toEqual([{ role: 'user', parts: [{ text: 'Which version was ABC-7 released in?' }] }])
    expect(lastSystem()).toContain('ABC-7 [Story] To Do')
    expect(lastSystem()).toContain('fix versions: 1.4.0 (unreleased)')
    // Tracker releases are always included; secrets never are.
    expect(lastSystem()).toMatch(/- Hotfix \(version 1\.4\.1\) · planned 2030-05-01 · not deployed yet/)
    expect(lastSystem()).not.toContain(JIRA.token)
  })

  it('lists what is in a version, with the release details', async () => {
    const c = await as(gemini)
    const r = await ask(c, "What's in 1.4.0?")
    expect(r.status).toBe(200)
    expect(lastSystem()).toContain('## Jira version 1.4.0 (unreleased, planned 2030-03-01): 150 issues (50 Story, 50 Bug, 50 Task)')
    expect(lastSystem()).toContain('## Release 1.4.0 (version 1.4.0) — details')
    expect(lastSystem()).toContain('Jenkins jobs: none linked')
    expect(r.body.sources.map((s: any) => s.kind)).toEqual(['release', 'jira_version'])
    // Not mentioned → not fetched in detail.
    expect(lastSystem()).not.toContain('## Release Hotfix')
    // Unimported Jira versions are still listed.
    expect(lastSystem()).toContain('- 1.3.0: released 2029-12-01')
  })

  it('searches Jira text for free-form questions; follow-ups keep the earlier question', async () => {
    const c = await as(gemini)
    const r = await ask(c, 'Which version fixed the login timeout?')
    expect(r.status).toBe(200)
    expect(jira.searches.at(-1)).toMatch(/project = "ABC" AND text ~ "login timeout"/)
    expect(lastSystem()).toContain('ABC-42 [Bug] Done · Dev Person — Login times out behind the SSO proxy')
    expect(lastSystem()).toContain('fix versions: 1.3.0 (released 2029-12-01)')

    await ask(c, 'Which version was ABC-7 released in?', 'and ABC-999?')
    expect(lastSystem()).toContain("ABC-999: does not exist in Jira")
    expect(lastSystem()).toContain('ABC-7 [Story]')
    expect(ai.requests.at(-1)!.body.contents.map((x: any) => x.role)).toEqual(['user', 'model', 'user'])
  })

  it('only answers for members of the project', async () => {
    const c = await as(gemini, 'john@example.com')
    expect((await ask(c, 'what is in 1.4.0?')).status).toBe(404)
  })

  it('validates the conversation', async () => {
    const c = await as(gemini)
    const r = await c.post(`/api/projects/${projectId}/chat`, { messages: [{ role: 'assistant', content: 'hi' }] })
    expect(r.status).toBe(400)
    expect((await c.post(`/api/projects/${projectId}/chat`, { messages: [{ role: 'user', content: 'x'.repeat(4001) }] })).status).toBe(400)
  })

  it('supports the OpenAI-compatible format', async () => {
    const r = await ask(await as(openai), 'Which version was ABC-7 released in?')
    expect(r.body.answer).toBe('From OpenAI format.')
    const body = ai.requests.at(-1)!.body
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('fix versions: 1.4.0')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Which version was ABC-7 released in?' })
  })

  it('supports Vertex AI behind Apigee (OAuth client credentials, token cached and renewed)', async () => {
    const vertexEnv = {
      AI_FORMAT: 'vertex', AI_BASE_URL: ai.url, AI_PROJECT_ID: AI.project, AI_LOCATION: 'europe-west1', AI_MODEL: 'gemini-2.5-pro',
      AI_TOKEN_URL: `${ai.url}/oauth/token`, AI_CLIENT_ID: AI.clientId, AI_CLIENT_SECRET: AI.clientSecret,
    }
    const vertex = await startServer(vertexEnv)
    const formAuth = await startServer({ ...vertexEnv, AI_TOKEN_AUTH: 'body', AI_TOKEN_SCOPE: 'genai' })
    const badClient = await startServer({ ...vertexEnv, AI_CLIENT_ID: 'rt-client-2', AI_CLIENT_SECRET: 'wrong' })
    const noProject = await startServer({ ...vertexEnv, AI_PROJECT_ID: '' })
    try {
      const c = await as(vertex)
      const before = ai.tokensIssued
      const r = await ask(c, 'Which version was ABC-7 released in?')
      expect(r.status).toBe(200)
      // Thought parts are left out of the answer.
      expect(r.body.answer).toBe('Vertex says hi.')
      const req = ai.requests.at(-1)!
      expect(req.path).toBe(`/v1/projects/${AI.project}/locations/europe-west1/publishers/google/models/gemini-2.5-pro:generateContent`)
      expect(req.headers.authorization).toBe(`Bearer token-${before + 1}`)
      expect(req.body.systemInstruction.parts[0].text).toContain('fix versions: 1.4.0')

      // The token is reused…
      await ask(c, 'and again')
      expect(ai.tokensIssued).toBe(before + 1)
      // …and renewed once when the gateway rejects it.
      ai.revokeToken()
      expect((await ask(c, 'once more')).status).toBe(200)
      expect(ai.tokensIssued).toBe(before + 2)

      // Client id/secret as form fields, with a scope.
      expect((await ask(await as(formAuth), 'hello')).status).toBe(200)
      expect(ai.tokenRequests.at(-1)).toEqual({ grant_type: 'client_credentials', scope: 'genai', client_id: AI.clientId, client_secret: AI.clientSecret })

      const bad = await ask(await as(badClient), 'hello')
      expect(bad.status).toBe(502)
      expect(bad.body.error.message).toBe('The AI login (AI_TOKEN_URL) rejected the credentials (HTTP 401). Message: Client credentials are invalid')

      // Gateway URL that already is the whole endpoint (placeholders allowed): used as is.
      const full = await startServer({
        ...vertexEnv,
        AI_BASE_URL: `${ai.url}/v1/projects/{project}/locations/europe-west1/publishers/google/models/{model}:generateContent`,
      })
      try {
        expect((await ask(await as(full), 'hello')).body.answer).toBe('Vertex says hi.')
        expect(ai.requests.at(-1)!.path).toBe(`/v1/projects/${AI.project}/locations/europe-west1/publishers/google/models/gemini-2.5-pro:generateContent`)
      } finally {
        await full.stop()
      }

      const missing = await ask(await as(noProject), 'hello')
      expect(missing.status).toBe(503)
      expect(missing.body.error.message).toMatch(/AI_PROJECT_ID/)
    } finally {
      await Promise.all([vertex, formAuth, badClient, noProject].map((x) => x.stop()))
    }
  })

  it('explains gateway errors', async () => {
    const r = await ask(await as(wrongSecret), 'hello')
    expect(r.status).toBe(502)
    expect(r.body.error.message).toBe('The AI service rejected the credentials (HTTP 401). Message: invalid app credentials')
  })
})
