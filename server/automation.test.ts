import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_OFFSETS } from './automation/settings.js'
import { client, remote, startServer } from './test/harness.js'

/** Reference for the database rule: N days before the target; weekends → the Friday before. */
function planned(target: string, daysBefore: number): string {
  const d = new Date(`${target}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - daysBefore)
  const dow = d.getUTCDay()
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1)
  if (dow === 0) d.setUTCDate(d.getUTCDate() - 2)
  return d.toISOString().slice(0, 10)
}

describe.skipIf(remote)('automation: planned dates', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let projectId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const dates = async (c: Awaited<ReturnType<typeof owner>>, id: string) =>
    Object.fromEntries((await c.get(`/api/releases/${id}`)).body.tasks.map((t: any) => [t.task_type, t.planned_date]))

  beforeAll(async () => {
    server = await startServer()
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Plan ${Date.now()}`, sprintsEnabled: false })).body.id
  })
  afterAll(async () => {
    await server?.stop()
  })

  it('plans every step back from the target date, skipping weekends', async () => {
    const c = await owner()
    const r = (await c.post('/api/releases', { project_id: projectId, name: 'P1', version: '1.0.0', planned_deployment_date: '2030-06-17' })).body
    const got = await dates(c, r.id)
    for (const [step, offset] of Object.entries(DEFAULT_OFFSETS)) expect(got[step], step).toBe(planned('2030-06-17', offset))
    // 2030-06-15 is a Saturday: "2 days before Monday" lands on Friday the 14th.
    expect(got.APPROVAL).toBe('2030-06-14')
  })

  it('moves open steps with the target; finished steps keep their date', async () => {
    const c = await owner()
    const r = (await c.post('/api/releases', { project_id: projectId, name: 'P2', version: '1.0.1', planned_deployment_date: '2030-06-17' })).body
    const before = await dates(c, r.id)
    const identified = (await c.get(`/api/releases/${r.id}`)).body.tasks.find((t: any) => t.task_type === 'RELEASE_IDENTIFIED')
    await c.patch(`/api/tasks/${identified.id}`, { status: 'COMPLETED' })
    await c.patch(`/api/releases/${r.id}`, { planned_deployment_date: '2030-06-24' })
    const after = await dates(c, r.id)
    expect(after.RELEASE_IDENTIFIED).toBe(before.RELEASE_IDENTIFIED)
    expect(after.RC_CREATION).toBe(planned(before.RC_CREATION, -7))
    expect(after.DEPLOYMENT).toBe('2030-06-24')
  })

  it('"Plan dates" re-plans open steps; projects can change offsets or turn it off', async () => {
    const c = await owner()
    const settings = (await c.get(`/api/projects/${projectId}/automation`)).body
    expect(settings.planDates).toEqual({ enabled: true, offsets: DEFAULT_OFFSETS })

    const r = (await c.post('/api/releases', { project_id: projectId, name: 'P3', version: '1.0.2', planned_deployment_date: '2030-06-17' })).body
    const rc = (await c.get(`/api/releases/${r.id}`)).body.tasks.find((t: any) => t.task_type === 'RC_CREATION')
    await c.patch(`/api/tasks/${rc.id}`, { planned_date: '2030-01-01' })

    const changed = { ...settings, planDates: { enabled: true, offsets: { ...DEFAULT_OFFSETS, RC_CREATION: 20 } } }
    expect((await c.put(`/api/projects/${projectId}/automation`, changed)).status).toBe(204)
    expect((await c.post(`/api/releases/${r.id}/plan-dates`)).body.changed).toBeGreaterThanOrEqual(1)
    expect((await dates(c, r.id)).RC_CREATION).toBe(planned('2030-06-17', 20))

    await c.put(`/api/projects/${projectId}/automation`, { ...settings, planDates: { ...settings.planDates, enabled: false } })
    const off = (await c.post('/api/releases', { project_id: projectId, name: 'P4', version: '1.0.3', planned_deployment_date: '2030-06-17' })).body
    expect(Object.values(await dates(c, off.id)).every((d) => d === null)).toBe(true)
  })

  it('only admins change automation; bad settings are rejected', async () => {
    const c = await owner()
    const settings = (await c.get(`/api/projects/${projectId}/automation`)).body
    expect((await c.put(`/api/projects/${projectId}/automation`, { ...settings, planDates: { enabled: true, offsets: { RC_CREATION: -3 } } })).status).toBe(400)
    // Add a member and check they can't change it.
    const member = client(server.base)
    const u = await member.login('maya@example.com')
    await c.post(`/api/projects/${projectId}/members`, { email: 'maya@example.com', role: 'MEMBER' }).catch(() => {})
    const r = await member.put(`/api/projects/${projectId}/automation`, settings)
    expect([403, 404]).toContain(r.status)
    expect(u.email).toBe('maya@example.com')
  })
})
