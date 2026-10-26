import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { checkAutoComplete } from './automation/worker.js'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { fakeGitHub, fakeJira, GITHUB, JIRA } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

describe.skipIf(remote)('automation: steps that complete themselves', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jira: Awaited<ReturnType<typeof fakeJira>>
  let github: Awaited<ReturnType<typeof fakeGitHub>>
  let projectId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const check = async () => {
    const pool = createPool(inject('appDatabaseUrl'))
    try {
      return await checkAutoComplete(pool, loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij' }), projectId)
    } finally {
      await pool.end()
    }
  }
  const step = async (c: Awaited<ReturnType<typeof owner>>, id: string, type: string) =>
    (await c.get(`/api/releases/${id}`)).body.tasks.find((t: any) => t.task_type === type)

  beforeAll(async () => {
    ;[server, jira, github] = await Promise.all([startServer(), fakeJira(), fakeGitHub()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Auto ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jira`, { authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: JIRA.token, projectKey: 'ABC' })
    await c.put(`/api/projects/${projectId}/integrations/github`, { authType: 'GITHUB', baseUrl: github.url, secret: GITHUB.token, repos: ['acme/app'] })
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jira?.close(), github?.close()])
  })

  it('completes RC creation once the RC branch exists, and Deployment once the Jira version is released', async () => {
    const c = await owner()
    // 1.4.0: branch exists, version unreleased. 1.5.0: no branch yet. 1.3.0: released in Jira.
    const [v14, v15, v13] = (await c.post(`/api/projects/${projectId}/jira/import`, { versionIds: ['10001', '10002', '10000'] })).body.created
    expect(await check()).toEqual({ rc: 2, deployed: 1 })
    expect(await step(c, v14, 'RC_CREATION')).toMatchObject({ status: 'COMPLETED' })
    expect((await step(c, v15, 'RC_CREATION')).status).toBe('NOT_STARTED')
    expect((await step(c, v14, 'DEPLOYMENT')).status).toBe('NOT_STARTED')
    const deployed = (await c.get(`/api/releases/${v13}`)).body
    expect(deployed.actual_deployment_date).toBe('2029-12-01')
    expect(deployed.tasks.find((t: any) => t.task_type === 'DEPLOYMENT').status).toBe('COMPLETED')
    const activity = (await c.get(`/api/releases/${v14}/activity`)).body.map((a: any) => a.description)
    expect(activity).toContain('RC creation completed automatically: release/1.4.0 found on GitHub (acme/app)')

    // The 1.5.0 branch appears later; checking again only changes that.
    github.addBranch('release/1.5.0')
    expect(await check()).toEqual({ rc: 1, deployed: 0 })
    expect((await step(c, v15, 'RC_CREATION')).status).toBe('COMPLETED')
  })

  it('can be turned off per project', async () => {
    const c = await owner()
    const settings = (await c.get(`/api/projects/${projectId}/automation`)).body
    await c.put(`/api/projects/${projectId}/automation`, { ...settings, autoComplete: { rcCreationFromGithub: false, deploymentFromJira: false } })
    const r = (await c.post('/api/releases', { project_id: projectId, name: 'Manual', version: '1.4.0', planned_deployment_date: '2031-01-01' })).body
    expect(await check()).toEqual({ rc: 0, deployed: 0 })
    expect((await step(c, r.id, 'RC_CREATION')).status).toBe('NOT_STARTED')
  })
})
