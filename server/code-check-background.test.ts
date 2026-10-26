import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { runBackgroundCodeChecks } from './automation/worker.js'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { deliverNotifications } from './notifications/notifier.js'
import { fakeGitHub, fakeJira, fakeTeams, GITHUB, JIRA } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

const ENV = { TEAMS_WEBHOOK_HOSTS: '127.0.0.1' }

describe.skipIf(remote)('automation: Code vs Jira in the background', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jira: Awaited<ReturnType<typeof fakeJira>>
  let github: Awaited<ReturnType<typeof fakeGitHub>>
  let teams: Awaited<ReturnType<typeof fakeTeams>>
  let projectId: string
  const config = () => loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij', ...ENV })
  const withPool = async <T>(fn: (pool: ReturnType<typeof createPool>) => Promise<T>) => {
    const pool = createPool(inject('appDatabaseUrl'))
    try {
      return await fn(pool)
    } finally {
      await pool.end()
    }
  }

  beforeAll(async () => {
    ;[server, jira, github, teams] = await Promise.all([startServer(ENV), fakeJira(), fakeGitHub(), fakeTeams()])
    const c = client(server.base)
    await c.login('charbel@example.com')
    projectId = (await c.post('/api/projects', { name: `Background ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jira`, { authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: JIRA.token, projectKey: 'ABC' })
    await c.put(`/api/projects/${projectId}/integrations/github`, { authType: 'GITHUB', baseUrl: github.url, secret: GITHUB.token, repos: ['acme/app'] })
    await c.put(`/api/projects/${projectId}/integrations/teams`, {
      authType: 'TEAMS',
      baseUrl: '',
      secret: teams.webhook,
      teams: { events: { blocked: false, jenkins: false, daily: false, code: true }, dailyTime: '09:00', timezone: 'UTC', weekdaysOnly: true },
    })
    const [current] = (await c.post(`/api/projects/${projectId}/jira/import`, { versionIds: ['10001'] })).body.created
    await c.put(`/api/releases/${current}/code-refs`, { refs: [{ repo: 'acme/app', baseRef: 'release/1.3.0', headRef: 'release/1.4.0' }] })
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jira?.close(), github?.close(), teams?.close()])
  })

  it('re-checks open releases, stores the result and tells Teams about new differences', async () => {
    expect(await withPool((p) => runBackgroundCodeChecks(p, config(), projectId))).toBe(1)
    const c = client(server.base)
    await c.login('charbel@example.com')
    const listed = (await c.get(`/api/releases?projectId=${projectId}`)).body[0]
    expect(listed.code_check).toMatchObject({ jira_only: 148, code_only: 2, no_key: 1, matched: 2 })

    const before = teams.cards.length
    expect(await withPool((p) => deliverNotifications(p, config(), 0))).toEqual({ sent: 1, failed: 0 })
    const card = teams.textOf(teams.cards[before])
    expect(card).toContain('Code vs Jira: 151 differences** (was 0): 148 in Jira not merged (50 marked Done), 2 merged not in the version, 1 merged without an issue')

    // Checked within the hour: skipped. Same result again: no new alert.
    expect(await withPool((p) => runBackgroundCodeChecks(p, config(), projectId))).toBe(0)
    expect(await withPool((p) => deliverNotifications(p, config(), 0))).toEqual({ sent: 0, failed: 0 })
  })
})
