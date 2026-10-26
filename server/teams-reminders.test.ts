import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { deliverNotifications, queueDueSoonReminders } from './notifications/notifier.js'
import { fakeTeams } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

const ENV = { TEAMS_WEBHOOK_HOSTS: '127.0.0.1' }

describe.skipIf(remote)('teams reminders', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let teams: Awaited<ReturnType<typeof fakeTeams>>
  let projectId: string
  let releaseId: string
  const config = () => loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij', ...ENV })
  const withPool = async <T>(fn: (pool: ReturnType<typeof createPool>) => Promise<T>) => {
    const pool = createPool(inject('appDatabaseUrl'))
    try {
      return await fn(pool)
    } finally {
      await pool.end()
    }
  }
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const task = async (type: string) => (await (await owner()).get(`/api/releases/${releaseId}`)).body.tasks.find((t: any) => t.task_type === type)

  beforeAll(async () => {
    ;[server, teams] = await Promise.all([startServer(ENV), fakeTeams()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Reminders ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/teams`, {
      authType: 'TEAMS',
      baseUrl: '',
      secret: teams.webhook,
      teams: { events: { blocked: false, jenkins: false, daily: false, code: false, dueSoon: true, approval: true }, dailyTime: '09:00', timezone: 'UTC', weekdaysOnly: true },
    })
    // Target Wed 2031-01-15: RC email (7 days before) is due Wed 2031-01-08.
    releaseId = (await c.post('/api/releases', { project_id: projectId, name: 'RC_rem', version: '9.0.0', planned_deployment_date: '2031-01-15' })).body.id
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), teams?.close()])
  })

  it('reminds the morning before a step is due (Friday covers Monday), once', async () => {
    expect((await task('RC_EMAIL')).planned_date).toBe('2031-01-08')
    const at = (iso: string) => withPool((p) => queueDueSoonReminders(p, new Date(iso)))
    expect(await at('2031-01-06T10:00:00Z')).toBe(0) // Monday: nothing due Tuesday
    expect(await at('2031-01-07T08:00:00Z')).toBe(0) // Tuesday before 09:00
    expect(await at('2031-01-07T09:30:00Z')).toBe(1) // Tuesday: RC email is due tomorrow
    expect(await at('2031-01-07T15:00:00Z')).toBe(0) // once a day
    const before = teams.cards.length
    await withPool((p) => deliverNotifications(p, config(), 0))
    expect(teams.textOf(teams.cards[before])).toContain('⏰ **RC email** is due tomorrow')

    // Friday 2031-01-10 covers Monday 2031-01-13 (Approval, 2 days before Wednesday).
    expect((await task('APPROVAL')).planned_date).toBe('2031-01-13')
    expect(await at('2031-01-10T09:30:00Z')).toBe(1)
  })

  it('posts "approval needed" when approval is requested', async () => {
    const c = await owner()
    const escalation = await task('RC_ESCALATION_EMAIL')
    await c.patch(`/api/tasks/${escalation.id}`, { status: 'COMPLETED' }) // requests approval
    const before = teams.cards.length
    await withPool((p) => deliverNotifications(p, config(), 0))
    const text = teams.cards.slice(before).map((card) => teams.textOf(card)).join('\n')
    expect(text).toContain('✍️ **Approval needed** by 2031-01-13 to deploy on 2031-01-15')
  })
})
