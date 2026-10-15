import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { client, remote, startServer } from './test/harness.js'

// Unique per run, so the suite can also run against a persistent deployment.
const run = Date.now().toString(36)

/**
 * End-to-end API tests: real Express app, real Postgres (fresh test database
 * with the demo seed). Users: charbel (owner), maya (member/admin), omar.
 */
let server: Awaited<ReturnType<typeof startServer>>
const api = () => client(server.base)

beforeAll(async () => {
  server = await startServer()
})
afterAll(async () => {
  await server?.stop()
})

describe('auth', () => {
  it('signs up, reads /me, logs out', async () => {
    const c = api()
    const signup = await c.post('/api/auth/signup', { email: `New.Person.${run}@Example.com`, password: 'welcome2026x', name: 'New Person' })
    expect(signup.status).toBe(201)
    expect(signup.body.user).toMatchObject({ email: `new.person.${run}@example.com`, name: 'New Person' })
    expect(signup.body.user.password_hash).toBeUndefined()
    expect((await c.get('/api/auth/me')).body.user.name).toBe('New Person')
    // A new account sees nothing.
    expect((await c.get('/api/projects')).body).toEqual([])
    expect((await c.get('/api/releases')).body).toEqual([])
    expect((await c.post('/api/auth/logout')).status).toBe(204)
    expect((await c.get('/api/auth/me')).status).toBe(401)
  })

  it('rejects weak passwords, duplicates and wrong credentials', async () => {
    const c = api()
    expect((await c.post('/api/auth/signup', { email: 'weak@example.com', password: 'short', name: 'W' })).status).toBe(422)
    const dup = await c.post('/api/auth/signup', { email: 'charbel@example.com', password: 'welcome2026x', name: 'X' })
    expect(dup.status).toBe(409)
    expect(dup.body.error.message).toMatch(/already exists/)
    const bad = await c.post('/api/auth/login', { email: 'charbel@example.com', password: 'wrong-password1' })
    expect(bad.status).toBe(401)
    const unknown = await c.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password1' })
    expect(unknown.status).toBe(401)
    expect(unknown.body.error.message).toBe(bad.body.error.message)
  })

  it('requires a session for the API', async () => {
    expect((await api().get('/api/projects')).status).toBe(401)
  })

  it('blocks cross-site requests (CSRF)', async () => {
    const c = api()
    await c.login('charbel@example.com')
    const noHeader = await c.raw('POST', '/api/projects', { name: 'x' }, { 'x-requested-with': '' })
    expect(noHeader.status).toBe(403)
    const evilOrigin = await c.raw('POST', '/api/projects', { name: 'x' }, { origin: 'https://evil.example' })
    expect(evilOrigin.status).toBe(403)
  })

  it('stores session tokens as hashes and sets a hardened cookie', async () => {
    const res = await fetch(`${server.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'release-tracker' },
      body: JSON.stringify({ email: 'charbel@example.com', password: 'password123' }),
    })
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/rt_session=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
  })
})

describe('projects, roles and invitations', () => {
  it('enforces the role model end to end', async () => {
    const owner = api()
    const other = api()
    await owner.login('charbel@example.com')
    const maya = await other.login('maya@example.com')

    const created = await owner.post('/api/projects', { name: `Roles ${Date.now()}`, sprintsEnabled: true })
    expect(created.status).toBe(201)
    const projectId = created.body.id as string
    const mine = (await owner.get('/api/projects')).body.find((p: any) => p.id === projectId)
    expect(mine.role).toBe('OWNER')

    // Non-member sees nothing.
    expect((await other.get(`/api/projects/${projectId}/members`)).body).toEqual([])
    expect((await other.get(`/api/releases?projectId=${projectId}`)).body).toEqual([])

    // Invite by email (existing user) → added as viewer.
    expect((await owner.post(`/api/projects/${projectId}/invitations/email`, { email: 'MAYA@example.com', role: 'VIEWER' })).body.result).toBe('added')
    const rel = await owner.post('/api/releases', { project_id: projectId, name: 'RC_1', version: '1.0.0', planned_deployment_date: '2030-02-01' })
    expect(rel.status).toBe(201)
    const detail = (await other.get(`/api/releases/${rel.body.id}`)).body
    expect(detail.tasks).toHaveLength(12)
    const task = detail.tasks.find((t: any) => t.task_type === 'RC_CREATION')

    // Viewer: read-only, can't invite or see invitations.
    expect((await other.patch(`/api/tasks/${task.id}`, { status: 'COMPLETED' })).status).toBe(403)
    expect((await other.post('/api/releases', { project_id: projectId, name: 'X', version: '1', planned_deployment_date: '2030-01-01' })).status).toBe(403)
    expect((await other.post(`/api/projects/${projectId}/invitations/email`, { email: 'x@example.com', role: 'MEMBER' })).status).toBe(403)
    expect((await other.get(`/api/projects/${projectId}/invitations`)).body).toEqual([])

    // Member: can edit, can't delete releases or change settings.
    expect((await owner.put(`/api/projects/${projectId}/members/${maya.id}`, { role: 'MEMBER' })).status).toBe(204)
    expect((await other.patch(`/api/tasks/${task.id}`, { status: 'COMPLETED' })).status).toBe(204)
    expect((await other.del(`/api/releases/${rel.body.id}`)).status).toBe(403)
    expect((await other.patch(`/api/projects/${projectId}`, { name: 'hijacked' })).status).toBe(403)
    expect((await other.put(`/api/projects/${projectId}/members/${maya.id}`, { role: 'ADMIN' })).status).toBe(403)

    // Admin vs owner rules.
    await owner.put(`/api/projects/${projectId}/members/${maya.id}`, { role: 'ADMIN' })
    const ownerId = (await owner.get('/api/auth/me')).body.user.id
    const demote = await other.put(`/api/projects/${projectId}/members/${ownerId}`, { role: 'MEMBER' })
    expect(demote.status).toBe(403)
    expect(demote.body.error.message).toMatch(/Only owners/)
    expect((await other.post(`/api/projects/${projectId}/invitations/email`, { email: 'y@example.com', role: 'OWNER' })).status).toBe(422)
    const leave = await owner.del(`/api/projects/${projectId}/members/${ownerId}`)
    expect(leave.status).toBe(422)
    expect(leave.body.error.message).toMatch(/at least one owner/)
    expect((await other.del(`/api/projects/${projectId}`)).status).toBe(403)

    // Pending email invite → joins on sign-up.
    expect((await other.post(`/api/projects/${projectId}/invitations/email`, { email: `later.${run}@example.com`, role: 'MEMBER' })).body.result).toBe('invited')
    const later = api()
    await later.post('/api/auth/signup', { email: `later.${run}@example.com`, password: 'welcome2026x', name: 'Later' })
    const laterProjects = (await later.get('/api/projects')).body
    expect(laterProjects.map((p: any) => [p.id, p.role])).toEqual([[projectId, 'MEMBER']])

    // Invite link: shown once, hashed, joinable, revocable.
    await owner.del(`/api/projects/${projectId}/members/${maya.id}`)
    const link = await owner.post(`/api/projects/${projectId}/invitations/link`, { role: 'MEMBER', days: 1 })
    const token = link.body.token as string
    expect(token.length).toBeGreaterThan(20)
    const info = await other.get(`/api/invites/${token}`)
    expect(info.body).toMatchObject({ project_id: projectId, role: 'MEMBER', already_member: false })
    expect((await other.post(`/api/invites/${token}/accept`)).body.projectId).toBe(projectId)
    const pending = (await owner.get(`/api/projects/${projectId}/invitations`)).body
    for (const inv of pending) await owner.del(`/api/invitations/${inv.id}`)
    await owner.del(`/api/projects/${projectId}/members/${maya.id}`)
    expect((await other.post(`/api/invites/${token}/accept`)).status).toBe(404)
    expect((await other.get(`/api/invites/not-a-real-token-123`)).status).toBe(404)

    // Owner deletes the project (cascade).
    expect((await owner.del(`/api/projects/${projectId}`)).status).toBe(204)
    expect((await owner.get(`/api/releases/${rel.body.id}`)).status).toBe(404)
  })
})

describe('workflow', () => {
  it('creates releases from project settings and keeps steps, reports and approval in sync', async () => {
    const c = api()
    await c.login('charbel@example.com')
    const projectId = (await c.post('/api/projects', { name: `Flow ${Date.now()}` })).body.id
    const sprint = await c.post('/api/sprints', { project_id: projectId, name: 'S1', start_date: '2030-01-07', end_date: '2030-01-18', status: 'ACTIVE' })
    expect(sprint.status).toBe(201)
    expect((await c.post('/api/sprints', { project_id: projectId, name: 'S2', start_date: '2030-01-21', end_date: '2030-01-19', status: 'PLANNED' })).status).toBe(422)

    const rel = (await c.post('/api/releases', { project_id: projectId, sprint_id: sprint.body.id, name: 'RC_1', version: '2.0.0', planned_deployment_date: '2030-01-17' })).body
    const dup = await c.post('/api/releases', { project_id: projectId, sprint_id: sprint.body.id, name: 'RC_1', version: '2.0.1', planned_deployment_date: '2030-01-17' })
    expect(dup.status).toBe(409)
    expect(dup.body.error.message).toMatch(/already exists in this sprint/)

    let d = (await c.get(`/api/releases/${rel.id}`)).body
    expect(d.tasks).toHaveLength(12)
    expect(d.reports).toHaveLength(3)
    expect(d.approval.status).toBe('PENDING')

    const step = (type: string) => d.tasks.find((t: any) => t.task_type === type)
    expect((await c.patch(`/api/tasks/${step('AUTOMATED_JOBS').id}`, { status: 'COMPLETED' })).status).toBe(204)
    expect((await c.patch(`/api/tasks/${step('AUTOMATED_JOBS').id}`, { link: 'javascript:alert(1)' })).status).toBe(400)
    expect((await c.patch(`/api/tasks/${step('AUTOMATED_JOBS').id}`, { unknown_field: 1 })).status).toBe(400)

    const hit = d.reports.find((r: any) => r.report_type === 'HIT')
    await c.patch(`/api/reports/${hit.id}`, { result: 'FAIL' })
    d = (await c.get(`/api/releases/${rel.id}`)).body
    expect(step('AUTOMATED_JOBS').completed_at).toBeTruthy()
    expect(step('HIT_REVIEW')).toMatchObject({ status: 'BLOCKED', blocker_reason: 'HIT report failed' })
    expect(d.reports.find((r: any) => r.report_type === 'HIT').reviewer.name).toBe('Charbel')

    await c.patch(`/api/approvals/${d.approval.id}`, { status: 'APPROVED' })
    d = (await c.get(`/api/releases/${rel.id}`)).body
    expect(step('APPROVAL').status).toBe('COMPLETED')
    expect(d.approval.approver.name).toBe('Charbel')

    // Settings drive new releases; existing ones keep their steps.
    expect((await c.patch(`/api/projects/${projectId}`, { enabled_steps: ['RELEASE_IDENTIFIED', 'HIT_REVIEW', 'DEPLOYMENT'] })).status).toBe(204)
    expect((await c.patch(`/api/projects/${projectId}`, { enabled_steps: ['HIT_REVIEW'] })).status).toBe(422)
    const lite = (await c.post('/api/releases', { project_id: projectId, name: 'LITE', version: '1', planned_deployment_date: '2030-02-01' })).body
    const settings = (await c.get('/api/projects')).body.find((p: any) => p.id === projectId)
    expect(settings.enabled_steps).toEqual(['RELEASE_IDENTIFIED', 'HIT_REVIEW', 'DEPLOYMENT'])
    const ld = (await c.get(`/api/releases/${lite.id}`)).body
    expect(ld.tasks.map((t: any) => t.task_type)).toEqual(['RELEASE_IDENTIFIED', 'HIT_REVIEW', 'DEPLOYMENT'])
    expect(ld.reports).toHaveLength(1)
    expect(ld.approval).toBeNull()
    expect(ld.sprint).toBeNull()

    // Lists, search, activity.
    const list = (await c.get(`/api/releases?projectId=${projectId}`)).body
    expect(list.map((r: any) => r.name).sort()).toEqual(['LITE', 'RC_1'])
    expect((await c.get(`/api/releases?projectId=${projectId}&sprintId=none`)).body.map((r: any) => r.name)).toEqual(['LITE'])
    const found = (await c.get('/api/search?q=2.0.0')).body
    expect(found.some((r: any) => r.id === rel.id && r.sprint_name === 'S1')).toBe(true)
    const activity = (await c.get(`/api/releases/${rel.id}/activity`)).body.map((a: any) => a.description)
    expect(activity).toEqual(expect.arrayContaining(['created RC_1 (2.0.0)', 'completed Automated jobs', 'reviewed the HIT report: FAIL', 'recorded approval']))
    // Report-driven step changes are not logged twice.
    expect(activity.some((a: string) => a.includes('HIT review'))).toBe(false)

    await c.del(`/api/projects/${projectId}`)
  })

  it('reads the demo seed with the right per-project statuses', async () => {
    const c = api()
    await c.login('omar@example.com')
    const projects = (await c.get('/api/projects')).body
    expect(projects.map((p: any) => `${p.name}:${p.role}`).sort()).toEqual(['Mobile App:VIEWER', 'Release Tracker:MEMBER'])
    const mobile = projects.find((p: any) => p.name === 'Mobile App')
    expect(mobile.sprints_enabled).toBe(false)
    // Real arrays, not Postgres array literals.
    for (const p of projects) expect(Array.isArray(p.enabled_steps)).toBe(true)
    expect(mobile.enabled_steps).toHaveLength(8)
    const releases = (await c.get(`/api/releases?projectId=${mobile.id}`)).body
    expect(releases.map((r: any) => r.version).sort()).toEqual(['3.1.0', '3.2.0'])
  })
})

describe('live updates', () => {
  it('streams a change event when a release changes', async () => {
    const c = api()
    await c.login('charbel@example.com')
    const release = (await c.get('/api/releases')).body.find((r: any) => r.actual_deployment_date === null)
    const controller = new AbortController()
    const res = await fetch(`${server.base}/api/releases/${release.id}/events`, {
      headers: { cookie: c.cookie },
      signal: controller.signal,
    })
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = res.body!.getReader()
    await reader.read() // ": connected"

    const detail = (await c.get(`/api/releases/${release.id}`)).body
    const note = detail.tasks[0]
    const received = (async () => {
      const decoder = new TextDecoder()
      let text = ''
      while (!text.includes('event: change')) {
        const { value, done } = await reader.read()
        if (done) break
        text += decoder.decode(value)
      }
      return text
    })()
    await c.patch(`/api/tasks/${note.id}`, { notes: `live ${Date.now()}` })
    await expect(Promise.race([received, new Promise((_, rej) => setTimeout(() => rej(new Error('no event')), 5000))])).resolves.toMatch(/event: change/)
    controller.abort()
  })

  it("doesn't stream releases the user can't see", async () => {
    const owner = api()
    await owner.login('charbel@example.com')
    const projectId = (await owner.post('/api/projects', { name: `Private ${Date.now()}` })).body.id
    const rel = (await owner.post('/api/releases', { project_id: projectId, name: 'P', version: '1', planned_deployment_date: '2030-01-01' })).body
    const outsider = api()
    await outsider.login('omar@example.com')
    const res = await fetch(`${server.base}/api/releases/${rel.id}/events`, { headers: { cookie: outsider.cookie } })
    expect(res.status).toBe(404)
    await owner.del(`/api/projects/${projectId}`)
  })
})

describe.skipIf(remote)('database privileges of the API login', () => {
  it("can't read credentials or sessions, and sees nothing without a user", async () => {
    const { default: pg } = await import('pg')
    const { inject } = await import('vitest')
    const db = new pg.Client({ connectionString: inject('appDatabaseUrl') })
    await db.connect()
    try {
      await expect(db.query('select password_hash from users')).rejects.toThrow(/permission denied/)
      await expect(db.query('select * from sessions')).rejects.toThrow(/permission denied/)
      // Integration credentials are write-only for the API login.
      await expect(db.query('select secret_encrypted from integrations')).rejects.toThrow(/permission denied/)
      await expect(db.query("insert into project_members (project_id, user_id, role) values (gen_random_uuid(), gen_random_uuid(), 'OWNER')")).rejects.toThrow(/permission denied/)
      // No app.user_id set → row level security shows nothing.
      expect((await db.query('select id from releases')).rowCount).toBe(0)
      expect((await db.query('select id from users')).rowCount).toBe(0)
    } finally {
      await db.end()
    }
  })
})
