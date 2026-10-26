import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { syncJira } from './automation/worker.js'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { fakeJira, JIRA } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

describe.skipIf(remote)('automation: releases follow Jira', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jira: Awaited<ReturnType<typeof fakeJira>>
  let projectId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const sync = async () => {
    const pool = createPool(inject('appDatabaseUrl'))
    try {
      return await syncJira(pool, loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij' }), projectId, '2030-01-15')
    } finally {
      await pool.end()
    }
  }
  const releases = async () => (await (await owner()).get(`/api/releases?projectId=${projectId}`)).body

  beforeAll(async () => {
    ;[server, jira] = await Promise.all([startServer(), fakeJira()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Sync ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jira`, { authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: JIRA.token, projectKey: 'ABC' })
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jira?.close()])
  })

  it('imports new unreleased versions only when turned on, skipping stale ones', async () => {
    const c = await owner()
    expect(await sync()).toEqual({ imported: 0, updated: 0 }) // off by default
    const settings = (await c.get(`/api/projects/${projectId}/automation`)).body
    await c.put(`/api/projects/${projectId}/automation`, { ...settings, jiraSync: { importVersions: true, syncDates: true } })
    jira.versions.push({ id: '10003', name: '1.2.9', released: false, archived: false, releaseDate: '2029-11-01', description: 'Forgotten' })

    expect(await sync()).toEqual({ imported: 2, updated: 0 })
    const list = await releases()
    expect(list.map((r: any) => [r.name, r.planned_deployment_date]).sort()).toEqual([
      ['1.4.0', '2030-03-01'],
      ['1.5.0', '2030-01-29'], // no Jira date: two weeks out
    ])
    const activity = (await c.get(`/api/releases/${list[0].id}/activity`)).body.map((a: any) => a.description)
    expect(activity.some((d: string) => d.startsWith('Release created automatically from Jira version'))).toBe(true)
    expect(await sync()).toEqual({ imported: 0, updated: 0 }) // nothing new
  })

  it('follows date changes and renames (but not names changed in the tracker)', async () => {
    const c = await owner()
    const v14 = jira.versions.find((v) => v.id === '10001')!
    const v15 = jira.versions.find((v) => v.id === '10002')!
    const before = (await releases()).find((r: any) => r.name === '1.4.0')
    const rcBefore = (await c.get(`/api/releases/${before.id}`)).body.tasks.find((t: any) => t.task_type === 'RC_CREATION').planned_date

    v14.releaseDate = '2030-03-08' // a week later
    v15.name = '1.5.0-beta'
    expect(await sync()).toEqual({ imported: 0, updated: 2 })
    const after = await releases()
    const r14 = after.find((r: any) => r.id === before.id)
    expect(r14.planned_deployment_date).toBe('2030-03-08')
    const rcAfter = (await c.get(`/api/releases/${before.id}`)).body.tasks.find((t: any) => t.task_type === 'RC_CREATION').planned_date
    expect(rcAfter > rcBefore).toBe(true) // planned steps moved along
    expect(after.map((r: any) => r.name)).toContain('1.5.0-beta')

    // A release renamed in the tracker keeps its name when Jira renames the version.
    const r15 = after.find((r: any) => r.name === '1.5.0-beta')
    await c.patch(`/api/releases/${r15.id}`, { name: 'Spring launch' })
    v15.name = '1.5.0'
    await sync()
    const final = (await c.get(`/api/releases/${r15.id}`)).body
    expect(final).toMatchObject({ name: 'Spring launch', jira_version_name: '1.5.0', version: '1.5.0' })
  })
})
