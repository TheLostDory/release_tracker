import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { processJenkinsStarts } from './automation/worker.js'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { fakeJenkins, JENKINS } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

describe.skipIf(remote)('automation: start Jenkins jobs and follow their runs', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jenkins: Awaited<ReturnType<typeof fakeJenkins>>
  let projectId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const background = async () => {
    const pool = createPool(inject('appDatabaseUrl'))
    try {
      return await processJenkinsStarts(pool, loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij' }))
    } finally {
      await pool.end()
    }
  }
  const newRelease = async (name: string) => {
    const version = `8.${name.slice(1)}.0`
    const { id } = (await (await owner()).post('/api/releases', { project_id: projectId, name, version, planned_deployment_date: '2030-09-02' })).body
    return { id, version }
  }

  beforeAll(async () => {
    ;[server, jenkins] = await Promise.all([startServer(), fakeJenkins()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Starts ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jenkins`, { authType: 'JENKINS', baseUrl: jenkins.url, username: JENKINS.user, secret: JENKINS.token })
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jenkins?.close()])
  })

  it('starts the configured jobs and attaches the runs they become', async () => {
    const c = await owner()
    const release = await newRelease('S1')
    const none = await c.post(`/api/releases/${release.id}/jenkins/start`)
    expect(none.status).toBe(409)
    expect(none.body.error.message).toMatch(/No Jenkins jobs are set up/)

    const settings = (await c.get(`/api/projects/${projectId}/automation`)).body
    settings.jenkins = {
      autoStart: false,
      jobs: [
        { purpose: 'LOAD_TEST', jobPath: 'perf/load-test', parameters: { RC_VERSION: '{{version}}' } },
        { purpose: 'LONGEVITY', jobPath: 'perf/longevity', parameters: {} },
        { purpose: 'HIT', jobPath: 'platform/hit-suite', parameters: { RELEASE: '{{name}}' } },
      ],
    }
    expect((await c.put(`/api/projects/${projectId}/automation`, settings)).status).toBe(204)

    const started = await c.post(`/api/releases/${release.id}/jenkins/start`)
    expect(started.status).toBe(202)
    expect(started.body).toMatchObject({ queued: 3, started: 3, resolved: 3, failed: 0 })
    expect(jenkins.triggered.slice(-3)).toEqual([
      { job: 'perf/load-test', params: { RC_VERSION: release.version } },
      { job: 'perf/longevity', params: {} },
      { job: 'platform/hit-suite', params: { RELEASE: 'S1' } },
    ])
    const runs = (await c.get(`/api/releases/${release.id}/jenkins/followed`)).body
    expect(runs.map((r: any) => [r.purpose, r.job_path, r.status?.building])).toEqual([
      ['LOAD_TEST', 'perf/load-test', true],
      ['LONGEVITY', 'perf/longevity', true],
      ['HIT', 'platform/hit-suite', true],
    ])
    expect((await c.get(`/api/releases/${release.id}/jenkins/starts`)).body).toEqual([])
    const step = (await c.get(`/api/releases/${release.id}`)).body.tasks.find((t: any) => t.task_type === 'AUTOMATED_JOBS')
    expect(step.status).toBe('IN_PROGRESS')
    const activity = (await c.get(`/api/releases/${release.id}/activity`)).body.map((a: any) => a.description)
    expect(activity).toContain('started Jenkins job perf/load-test')
  })

  it('waits while Jenkins queues the builds, then replaces the older runs', async () => {
    const c = await owner()
    const release = await newRelease('S2')
    await c.post(`/api/releases/${release.id}/jenkins/start`)
    const first = (await c.get(`/api/releases/${release.id}/jenkins/followed`)).body.find((r: any) => r.purpose === 'LONGEVITY').build_number

    jenkins.holdQueue(true)
    const queued = (await c.post(`/api/releases/${release.id}/jenkins/start`)).body
    expect(queued).toMatchObject({ queued: 3, started: 3, resolved: 0 })
    expect((await c.get(`/api/releases/${release.id}/jenkins/starts`)).body.map((s: any) => s.state)).toEqual(['queued', 'queued', 'queued'])
    // Asking again while they wait doesn't start them twice.
    expect((await c.post(`/api/releases/${release.id}/jenkins/start`)).body.queued).toBe(0)

    jenkins.releaseQueue()
    jenkins.holdQueue(false)
    expect((await background()).resolved).toBe(3)
    const runs = (await c.get(`/api/releases/${release.id}/jenkins/followed`)).body
    expect(runs).toHaveLength(3)
    expect(runs.find((r: any) => r.purpose === 'LONGEVITY').build_number).toBeGreaterThan(first)
  })

  it('reports builds cancelled in Jenkins; they can be dismissed', async () => {
    const c = await owner()
    const release = await newRelease('S3')
    jenkins.holdQueue(true)
    await c.post(`/api/releases/${release.id}/jenkins/start`)
    jenkins.cancelQueued()
    jenkins.holdQueue(false)
    await background()
    const starts = (await c.get(`/api/releases/${release.id}/jenkins/starts`)).body
    expect(starts.map((s: any) => [s.state, s.last_error])).toEqual(Array(3).fill(['failed', 'The job was cancelled in Jenkins before it started.']))
    expect((await c.del(`/api/jenkins/starts/${starts[0].id}`)).status).toBe(204)
    expect((await c.get(`/api/releases/${release.id}/jenkins/starts`)).body).toHaveLength(2)
  })

  it('starts the jobs by itself when RC creation completes (if turned on)', async () => {
    const c = await owner()
    const settings = (await c.get(`/api/projects/${projectId}/automation`)).body
    await c.put(`/api/projects/${projectId}/automation`, { ...settings, jenkins: { ...settings.jenkins, autoStart: true } })
    const release = await newRelease('S4')
    const rc = (await c.get(`/api/releases/${release.id}`)).body.tasks.find((t: any) => t.task_type === 'RC_CREATION')
    await c.patch(`/api/tasks/${rc.id}`, { status: 'COMPLETED' })
    expect((await c.get(`/api/releases/${release.id}/jenkins/starts`)).body.map((s: any) => s.state)).toEqual(['to_start', 'to_start', 'to_start'])
    expect((await background()).resolved).toBeGreaterThanOrEqual(3)
    expect((await c.get(`/api/releases/${release.id}/jenkins/followed`)).body).toHaveLength(3)
  })
})
