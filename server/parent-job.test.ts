import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { syncFollowedBuilds } from './integrations/poller.js'
import { fakeJenkins, JENKINS } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

describe.skipIf(remote)('automation: a parent job fills the Load Test / Longevity / HIT slots', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jenkins: Awaited<ReturnType<typeof fakeJenkins>>
  let projectId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const poll = async () => {
    const pool = createPool(inject('appDatabaseUrl'))
    try {
      return await syncFollowedBuilds(pool, loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij' }))
    } finally {
      await pool.end()
    }
  }
  const slots = async (releaseId: string) =>
    Object.fromEntries(
      ((await (await owner()).get(`/api/releases/${releaseId}/jenkins/followed`)).body as any[]).map((r) => [r.purpose, { job: r.job_path, n: r.build_number, parent: r.parent_run_id, id: r.id }]),
    )

  beforeAll(async () => {
    ;[server, jenkins] = await Promise.all([startServer(), fakeJenkins()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Parent ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jenkins`, { authType: 'JENKINS', baseUrl: jenkins.url, username: JENKINS.user, secret: JENKINS.token })
    const settings = (await c.get(`/api/projects/${projectId}/automation`)).body
    settings.jenkins = {
      autoStart: false,
      jobs: [
        { purpose: 'AUTOMATED', jobPath: 'release/rc-validation', parameters: { RC: '{{version}}' } },
        // Named without "hit": listed so it's recognised; started by the parent, not by "Start jobs".
        { purpose: 'HIT', jobPath: 'platform/hit-suite', parameters: {}, startedByParent: true },
      ],
    }
    expect((await c.put(`/api/projects/${projectId}/automation`, settings)).status).toBe(204)
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jenkins?.close()])
  })

  it('starts only the parent; the runs it starts fill their slots and drive the step', async () => {
    const c = await owner()
    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_P', version: '10.0.0', planned_deployment_date: '2031-03-03' })).body
    const started = (await c.post(`/api/releases/${release.id}/jenkins/start`)).body
    expect(started).toMatchObject({ queued: 1, resolved: 1 })
    expect(jenkins.triggered.at(-1)).toEqual({ job: 'release/rc-validation', params: { RC: '10.0.0' } })

    const s = await slots(release.id)
    expect(s.AUTOMATED.job).toBe('release/rc-validation')
    expect(s.LOAD_TEST).toMatchObject({ job: 'perf/load-test', parent: s.AUTOMATED.id })
    expect(s.LONGEVITY).toMatchObject({ job: 'perf/longevity', parent: s.AUTOMATED.id })
    expect(s.HIT).toMatchObject({ job: 'platform/hit-suite', parent: s.AUTOMATED.id })
    const step = async () => (await c.get(`/api/releases/${release.id}`)).body.tasks.find((t: any) => t.task_type === 'AUTOMATED_JOBS').status
    expect(await step()).toBe('IN_PROGRESS')

    // Everything finishes; the 2-minute background check picks it up.
    for (const [job, slot] of [['perf/load-test', s.LOAD_TEST], ['perf/longevity', s.LONGEVITY], ['platform/hit-suite', s.HIT]] as const) {
      jenkins.finishBuild(job, slot.n, 'SUCCESS')
    }
    jenkins.finishBuild('release/rc-validation', s.AUTOMATED.n, 'SUCCESS')
    expect(await poll()).toBeGreaterThanOrEqual(4) // also other tests' running builds (shared test database)
    expect(await step()).toBe('COMPLETED')
    const report = (await c.get(`/api/releases/${release.id}`)).body.reports.find((r: any) => r.report_type === 'LOAD_TEST')
    expect(report.report_url).toBe(`${jenkins.url}/job/perf/job/load-test/${s.LOAD_TEST.n}/artifact/reports/load.html`)
  })

  it('a newer parent run replaces the children; the older one never takes them back', async () => {
    const c = await owner()
    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_Q', version: '10.1.0', planned_deployment_date: '2031-03-10' })).body
    await c.post(`/api/releases/${release.id}/jenkins/start`)
    const first = await slots(release.id)
    // A second parent run, pasted by link (e.g. started from Jenkins by hand).
    await c.post(`/api/releases/${release.id}/jenkins/start`) // starts parent run #2 (another "other job" run)
    const second = await slots(release.id)
    expect(second.LONGEVITY.n).toBeGreaterThan(first.LONGEVITY.n)
    // Refreshing the old parent run doesn't bring its children back.
    const runs = (await c.get(`/api/releases/${release.id}/jenkins/followed`)).body
    const oldParent = runs.find((r: any) => r.purpose === 'AUTOMATED' && r.build_number === first.AUTOMATED.n)
    expect(oldParent).toBeTruthy()
    await c.post(`/api/jenkins/followed/${oldParent.id}/refresh`)
    expect((await slots(release.id)).LONGEVITY.n).toBe(second.LONGEVITY.n)
  })

  it('works for a parent run pasted by link too, matching children by name', async () => {
    const c = await owner()
    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_R', version: '10.2.0', planned_deployment_date: '2031-03-17' })).body
    jenkins.jobs.get('release/rc-validation')!.push({ number: 99, result: 'SUCCESS', building: false, downstream: [['perf/load-test', 9], ['perf/longevity', 20]] })
    const r = await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/release/job/rc-validation/99/`, purpose: 'AUTOMATED' })
    expect(r.status).toBe(201)
    const s = await slots(release.id)
    expect(s.LOAD_TEST).toMatchObject({ job: 'perf/load-test', n: 9 })
    expect(s.LONGEVITY).toMatchObject({ job: 'perf/longevity', n: 20 })
  })
})
