import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { syncFollowedBuilds } from './integrations/poller.js'
import { fakeJenkins, JENKINS } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

/** Load Test / Longevity / HIT runs added to the Automated jobs step by link. */
describe.skipIf(remote)('automated job runs', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jenkins: Awaited<ReturnType<typeof fakeJenkins>>
  let releaseId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const job = (path: string, n: number | string) => `${jenkins.url}/job/${path.split('/').join('/job/')}/${n}/`

  beforeAll(async () => {
    ;[server, jenkins] = await Promise.all([startServer(), fakeJenkins()])
    const c = await owner()
    const p = (await c.post('/api/projects', { name: `Auto jobs ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${p}/integrations/jenkins`, { authType: 'JENKINS', baseUrl: jenkins.url, username: JENKINS.user, secret: JENKINS.token })
    releaseId = (await c.post('/api/releases', { project_id: p, name: 'RC_A', version: '7.0.0', planned_deployment_date: '2030-06-01' })).body.id
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jenkins?.close()])
  })

  it('drives the step and fills the report links from the runs', async () => {
    const c = await owner()
    const detail = async () => (await c.get(`/api/releases/${releaseId}`)).body
    const step = async () => (await detail()).tasks.find((t: any) => t.task_type === 'AUTOMATED_JOBS')
    const report = async (type: string) => (await detail()).reports.find((r: any) => r.report_type === type)

    // Load Test passed → step completed (the only run so far), report link = its HTML report.
    const load = await c.post(`/api/releases/${releaseId}/jenkins/followed`, { url: job('perf/load-test', 8), purpose: 'LOAD_TEST' })
    expect(load.status).toBe(201)
    expect(load.body).toMatchObject({ purpose: 'LOAD_TEST', status: { result: 'SUCCESS', reportUrl: `${job('perf/load-test', 8)}artifact/reports/load.html` } })
    expect((await step()).status).toBe('COMPLETED')
    expect((await report('LOAD_TEST')).report_url).toBe(`${job('perf/load-test', 8)}artifact/reports/load.html`)

    // Longevity still running → in progress; it has an estimate for the time left.
    const longevity = await c.post(`/api/releases/${releaseId}/jenkins/followed`, { url: job('perf/longevity', 'lastBuild'), purpose: 'LONGEVITY' })
    expect(longevity.body).toMatchObject({ build_number: 20, status: { building: true, estimatedDuration: 1800000 } })
    expect((await step()).status).toBe('IN_PROGRESS')
    await c.post(`/api/releases/${releaseId}/jenkins/followed`, { url: job('platform/hit-suite', 7), purpose: 'HIT' })
    expect((await step()).status).toBe('IN_PROGRESS')

    // The background check picks up the failure without anyone on the page.
    jenkins.finish('perf/longevity', 'FAILURE')
    const db = createPool(inject('appDatabaseUrl'))
    try {
      const config = loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij' })
      expect(await syncFollowedBuilds(db, config)).toBeGreaterThanOrEqual(1)
    } finally {
      await db.end()
    }
    expect(await step()).toMatchObject({ status: 'BLOCKED', blocker_reason: 'Jenkins: perf/longevity #20 failure' })
    const activity = (await c.get(`/api/releases/${releaseId}/activity`)).body.map((a: any) => a.description)
    expect(activity).toContain('Jenkins: Longevity perf/longevity #20 failure')
    expect((await report('LONGEVITY')).report_url).toBeNull() // failed runs don't fill the report

    // A re-run replaces the Longevity run; everything passed → completed.
    jenkins.jobs.get('perf/longevity')!.push({ number: 21, result: 'SUCCESS', building: false })
    const rerun = await c.post(`/api/releases/${releaseId}/jenkins/followed`, { url: job('perf/longevity', 21), purpose: 'LONGEVITY' })
    expect(rerun.status).toBe(201)
    const runs = (await c.get(`/api/releases/${releaseId}/jenkins/followed`)).body
    expect(runs.map((r: any) => [r.purpose, r.build_number])).toEqual([
      ['LOAD_TEST', 8],
      ['HIT', 7],
      ['LONGEVITY', 21],
    ])
    expect(await step()).toMatchObject({ status: 'COMPLETED', blocker_reason: null })
    expect((await report('LONGEVITY')).report_url).toBe(job('perf/longevity', 21))

    // UNSTABLE (e.g. some tests flagged) doesn't block: it counts as finished and fills the report.
    jenkins.jobs.get('perf/longevity')!.push({ number: 22, result: 'UNSTABLE', building: false })
    await c.post(`/api/releases/${releaseId}/jenkins/followed`, { url: job('perf/longevity', 22), purpose: 'LONGEVITY' })
    expect(await step()).toMatchObject({ status: 'COMPLETED', blocker_reason: null })
    expect((await report('LONGEVITY')).report_url).toBe(job('perf/longevity', 22))

    // Removing a run re-applies the rule to the rest.
    expect((await c.del(`/api/jenkins/followed/${load.body.id}`)).status).toBe(204)
    expect((await step()).status).toBe('COMPLETED')
  })
})
