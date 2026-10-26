import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { processTestAnalyses } from './automation/test-analysis.js'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { fakeJenkins, fakeJira, JENKINS, JIRA } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

describe.skipIf(remote)('automation: failed tests of HIT / Load Test runs → Jira bugs', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jenkins: Awaited<ReturnType<typeof fakeJenkins>>
  let jira: Awaited<ReturnType<typeof fakeJira>>
  let projectId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }
  const process = async (releaseId: string) => {
    const pool = createPool(inject('appDatabaseUrl'))
    try {
      return await processTestAnalyses(pool, loadConfig({ DATABASE_URL: inject('appDatabaseUrl'), ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij' }), releaseId)
    } finally {
      await pool.end()
    }
  }

  beforeAll(async () => {
    ;[server, jenkins, jira] = await Promise.all([startServer(), fakeJenkins(), fakeJira()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Failures ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jenkins`, { authType: 'JENKINS', baseUrl: jenkins.url, username: JENKINS.user, secret: JENKINS.token })
    await c.put(`/api/projects/${projectId}/integrations/jira`, { authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: JIRA.token, projectKey: 'ABC' })
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jenkins?.close(), jira?.close()])
  })

  it('reads the failed tests from the HIT report and lists the bugs linked to each', async () => {
    const c = await owner()
    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_F', version: '12.0.0', planned_deployment_date: '2031-04-01' })).body
    const run = (await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/platform/job/hit-suite/7/`, purpose: 'HIT' })).body
    // The finished run queued an analysis; the worker does it.
    expect((await c.get(`/api/releases/${release.id}/test-analyses`)).body).toMatchObject([{ run_id: run.id, state: 'pending' }])
    expect(await process(release.id)).toEqual({ done: 1, failed: 0 })

    const [analysis] = (await c.get(`/api/releases/${release.id}/test-analyses`)).body
    expect(analysis.state).toBe('done')
    const tests = Object.fromEntries(analysis.result.failedTests.map((t: any) => [t.name, t.bugs.map((b: any) => `${b.key} ${b.type} (${b.via})`)]))
    expect(tests).toEqual({
      'HIT-Checkout timeout': ['ABC-300 Bug (mentions the test)'], // not the decoy ABC-301
      test_export_ABC_42: ['ABC-42 Bug (key in the test name)'],
      'HIT-Search filters': ['ABC-201 Field Bug (linked to test case ABC-200)'],
      'HIT-No bug yet': [],
    })
    expect(analysis.result.reportUrl).toBe(`${jenkins.url}/job/platform/job/hit-suite/7/artifact/reports/hit.html`)
  })

  it('only for the chosen run types; "Check again" re-reads; runs without a report say so', async () => {
    const c = await owner()
    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_G', version: '12.1.0', planned_deployment_date: '2031-04-08' })).body
    // Longevity isn't analysed by default.
    jenkins.jobs.get('perf/longevity')!.push({ number: 50, result: 'SUCCESS', building: false })
    await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/perf/job/longevity/50/`, purpose: 'LONGEVITY' })
    expect((await c.get(`/api/releases/${release.id}/test-analyses`)).body).toEqual([])

    // A Load Test run without an HTML report.
    jenkins.jobs.get('perf/load-test')!.push({ number: 60, result: 'FAILURE', building: false })
    const run = (await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/perf/job/load-test/60/`, purpose: 'LOAD_TEST' })).body
    await process(release.id)
    expect((await c.get(`/api/releases/${release.id}/test-analyses`)).body[0]).toMatchObject({ state: 'failed', error: expect.stringMatching(/no HTML report/) })

    expect((await c.post(`/api/jenkins/followed/${run.id}/analyze`)).status).toBe(202)
    expect((await c.get(`/api/releases/${release.id}/test-analyses`)).body[0].state).toBe('failed')
  })

  it('previews what a pattern finds in a report (admins)', async () => {
    const c = await owner()
    const reportUrl = `${jenkins.url}/job/platform/job/hit-suite/7/artifact/reports/hit.html`
    expect((await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl })).body.failedTests).toEqual([
      'HIT-Checkout timeout',
      'test_export_ABC_42',
      'HIT-Search filters',
      'HIT-No bug yet',
    ])
    // A row reads "HIT-Checkout timeout FAIL 30 s".
    expect((await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl, pattern: String.raw`^(HIT-.+?) FAIL` })).body.failedTests).toEqual([
      'HIT-Checkout timeout',
      'HIT-Search filters',
      'HIT-No bug yet',
    ])
    expect((await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl, pattern: '(' })).status).toBe(422)
    expect((await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl: 'https://elsewhere.example.com/r.html' })).status).toBe(422)
  })
})
