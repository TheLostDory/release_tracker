import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { deliverNotifications, localNow, queueDailySummaries } from './notifications/notifier.js'
import { fakeJenkins, fakeTeams, JENKINS } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

const ENV = { TEAMS_WEBHOOK_HOSTS: '127.0.0.1', APP_URL: 'http://tracker.test:8800' }

/** Teams notifications: blocked steps, finished Jenkins jobs, daily summary. */
describe.skipIf(remote)('teams notifications', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let teams: Awaited<ReturnType<typeof fakeTeams>>
  let jenkins: Awaited<ReturnType<typeof fakeJenkins>>
  let projectId: string
  let releaseId: string
  const db = () => createPool(inject('appDatabaseUrl'))
  const config = () => loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij', ...ENV })
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const settings = (over: object = {}) => ({
    events: { blocked: true, jenkins: true, daily: true },
    dailyTime: '09:00',
    timezone: 'Europe/Paris',
    weekdaysOnly: true,
    ...over,
  })
  /** Runs one delivery round (no batching delay). */
  const deliver = async () => {
    const pool = db()
    try {
      return await deliverNotifications(pool, config(), 0)
    } finally {
      await pool.end()
    }
  }

  beforeAll(async () => {
    ;[server, teams, jenkins] = await Promise.all([startServer(ENV), fakeTeams(), fakeJenkins()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Teams ${Date.now()}`, sprintsEnabled: false })).body.id
    releaseId = (await c.post('/api/releases', { project_id: projectId, name: 'SP_III_RC', version: '8.0.0', planned_deployment_date: '2030-07-01' })).body.id
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), teams?.close(), jenkins?.close()])
  })

  it('connects by posting a test message; only Teams webhook addresses are accepted', async () => {
    const c = await owner()
    const save = (secret: string | undefined, teamsSettings = settings()) =>
      c.put(`/api/projects/${projectId}/integrations/teams`, { authType: 'TEAMS', baseUrl: '', ...(secret ? { secret } : {}), teams: teamsSettings })
    const elsewhere = await save('https://evil.example.com/hook')
    expect(elsewhere.status).toBe(422)
    expect(elsewhere.body.error.message).toMatch(/doesn't look like a Teams Workflows webhook/)
    expect((await save(teams.webhook, { ...settings(), dailyTime: '9am' })).status).toBe(400)

    const ok = await save(teams.webhook)
    expect(ok.status).toBe(200)
    expect(ok.body.message).toBe('Connected: a test message was posted to the channel')
    expect(teams.textOf(teams.cards.at(-1))).toContain('Release Tracker is connected')
    const listed = (await c.get(`/api/projects/${projectId}/integrations`)).body.find((i: any) => i.kind === 'TEAMS')
    expect(listed).toMatchObject({ base_url: new URL(teams.webhook).origin, settings: settings() })
    expect(JSON.stringify(listed)).not.toContain('/workflows/')
    // Re-saving without the URL keeps it; "Test connection" posts again.
    expect((await save(undefined, settings())).status).toBe(200)
    expect((await c.post(`/api/projects/${projectId}/integrations/teams/test`)).body.message).toMatch(/test message/)
  })

  it('posts a blocked step, and a Jenkins failure together with the step it blocks', async () => {
    const c = await owner()
    const tasks = (await c.get(`/api/releases/${releaseId}`)).body.tasks
    const rc = tasks.find((t: any) => t.task_type === 'RC_CREATION')
    expect((await c.patch(`/api/tasks/${rc.id}`, { status: 'BLOCKED', blocker_reason: 'Build server down' })).status).toBe(204)
    const before = teams.cards.length
    expect(await deliver()).toEqual({ sent: 1, failed: 0 })
    const blocked = teams.textOf(teams.cards[before])
    expect(blocked).toContain('SP\\\\_III\\\\_RC · 8.0.0') // escaped, so it doesn't turn italic
    expect(blocked).toContain('RC creation blocked**: Build server down (by Charbel)')
    expect(JSON.stringify(teams.cards[before].actions)).toContain('http://tracker.test:8800/releases/')

    // Jenkins: a failing Longevity run blocks Automated jobs → one card with both.
    await c.put(`/api/projects/${projectId}/integrations/jenkins`, { authType: 'JENKINS', baseUrl: jenkins.url, username: JENKINS.user, secret: JENKINS.token })
    jenkins.jobs.get('perf/longevity')!.push({ number: 30, result: 'FAILURE', building: false })
    await c.post(`/api/releases/${releaseId}/jenkins/followed`, { url: `${jenkins.url}/job/perf/job/longevity/30/`, purpose: 'LONGEVITY' })
    expect(await deliver()).toEqual({ sent: 2, failed: 0 })
    const both = teams.textOf(teams.cards.at(-1))
    expect(both).toContain('❌ Jenkins Longevity perf/longevity #30 failure')
    expect(both).toContain('Automated jobs blocked**: Jenkins: perf/longevity #30 failure (by Charbel)')
    expect(teams.cards.length).toBe(before + 2)
  })

  it('respects switched-off events, and retries when Teams fails', async () => {
    const c = await owner()
    await c.put(`/api/projects/${projectId}/integrations/teams`, { authType: 'TEAMS', baseUrl: '', teams: settings({ events: { blocked: true, jenkins: false, daily: true } }) })
    jenkins.jobs.get('perf/load-test')!.push({ number: 9, result: 'SUCCESS', building: false })
    await c.post(`/api/releases/${releaseId}/jenkins/followed`, { url: `${jenkins.url}/job/perf/job/load-test/9/`, purpose: 'LOAD_TEST' })
    expect(await deliver()).toEqual({ sent: 0, failed: 0 }) // Jenkins events are off

    const tasks = (await c.get(`/api/releases/${releaseId}`)).body.tasks
    const email = tasks.find((t: any) => t.task_type === 'RC_EMAIL')
    await c.patch(`/api/tasks/${email.id}`, { status: 'BLOCKED', blocker_reason: 'Waiting for QA sign-off' })
    teams.failNextPosts(1)
    expect(await deliver()).toEqual({ sent: 0, failed: 1 })
    const teamsRow = (await c.get(`/api/projects/${projectId}/integrations`)).body.find((i: any) => i.kind === 'TEAMS')
    expect(teamsRow.last_error).toBe('Teams: Teams returned HTTP 500. Message: Flow run failed')
    expect(await deliver()).toEqual({ sent: 0, failed: 0 }) // waits before retrying (back-off)
  })

  it('sends the daily summary once per day, after its time, on weekdays', async () => {
    const pool = db()
    try {
      const cfg = config()
      // Mon 2026-10-19 08:30 in Paris (06:30 UTC): too early.
      expect(await queueDailySummaries(pool, cfg, new Date('2026-10-19T06:30:00Z'))).toBe(0)
      // 09:15 Paris: queued once, even if checked again.
      expect(await queueDailySummaries(pool, cfg, new Date('2026-10-19T07:15:00Z'))).toBeGreaterThanOrEqual(1)
      expect(await queueDailySummaries(pool, cfg, new Date('2026-10-19T08:00:00Z'))).toBe(0)
      // Saturday: skipped (weekdays only).
      expect(await queueDailySummaries(pool, cfg, new Date('2026-10-24T08:00:00Z'))).toBe(0)
    } finally {
      await pool.end()
    }
    const before = teams.cards.length
    await deliver()
    const summaries = teams.cards.slice(before).filter((card) => teams.textOf(card).includes('release summary'))
    const ours = summaries.find((card) => teams.textOf(card).includes('SP\\\\_III\\\\_RC'))
    expect(ours).toBeTruthy()
    const text = teams.textOf(ours)
    expect(text).toContain('2026-10-19 · 1 open release')
    expect(text).toContain('RC creation blocked')
    expect(text).toContain('RC email blocked')
  })

  it('reads local time in the project time zone', () => {
    expect(localNow('Europe/Paris', new Date('2026-10-19T07:15:00Z'))).toEqual({ day: '2026-10-19', time: '09:15', weekday: 'Mon' })
    expect(localNow('America/New_York', new Date('2026-10-19T03:00:00Z'))).toEqual({ day: '2026-10-18', time: '23:00', weekday: 'Sun' })
    expect(localNow('Not/AZone', new Date('2026-10-19T03:00:00Z')).time).toBe('03:00')
  })
})
