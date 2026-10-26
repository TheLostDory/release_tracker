import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fakeJira, JIRA } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

describe.skipIf(remote)('email drafts', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jira: Awaited<ReturnType<typeof fakeJira>>
  let projectId: string
  let releaseId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }

  beforeAll(async () => {
    ;[server, jira] = await Promise.all([startServer({ APP_URL: 'http://tracker.test:8800' }), fakeJira()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Emails ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jira`, { authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: JIRA.token, projectKey: 'ABC' })
    ;[releaseId] = (await c.post(`/api/projects/${projectId}/jira/import`, { versionIds: ['10002'] })).body.created
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jira?.close()])
  })

  it('drafts the RC email from the release, with the project recipients', async () => {
    const c = await owner()
    const settings = (await c.get(`/api/projects/${projectId}/automation`)).body
    settings.emails.recipients.RC_EMAIL = { to: 'qa@example.com; dev@example.com', cc: 'pm@example.com' }
    expect((await c.put(`/api/projects/${projectId}/automation`, settings)).status).toBe(204)

    const r = await c.get(`/api/releases/${releaseId}/emails/RC_EMAIL`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ step: 'RC_EMAIL', to: 'qa@example.com; dev@example.com', cc: 'pm@example.com', subject: 'RC 1.5.0 (1.5.0) is ready', notes: [] })
    expect(r.body.text).toContain('What it contains (2: 1 story, 1 bug)')
    expect(r.body.text).toContain('Release details: http://tracker.test:8800/releases/')
    expect(r.body.html).toContain(`<a href="${jira.url}/browse/ABC-1">ABC-1 Issue 1</a>`)
  })

  it('drafts the other two, and refuses unknown emails and outsiders', async () => {
    const c = await owner()
    expect((await c.get(`/api/releases/${releaseId}/emails/RC_ESCALATION_EMAIL`)).body.subject).toBe('Action needed: approval for 1.5.0 (1.5.0)')
    expect((await c.get(`/api/releases/${releaseId}/emails/RELEASE_EMAIL`)).body.to).toBe('')
    expect((await c.get(`/api/releases/${releaseId}/emails/OTHER`)).status).toBe(404)
    const outsider = client(server.base)
    await outsider.login('john@example.com')
    expect((await outsider.get(`/api/releases/${releaseId}/emails/RC_EMAIL`)).status).toBe(404)
  })
})
