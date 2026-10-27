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
    expect((await c.get(`/api/releases/${release.id}/test-analyses`)).body[0]).toMatchObject({ state: 'failed', error: expect.stringMatching(/^No report found/) })

    expect((await c.post(`/api/jenkins/followed/${run.id}/analyze`)).status).toBe(202)
    expect((await c.get(`/api/releases/${release.id}/test-analyses`)).body[0].state).toBe('failed')
  })

  it('previews what a pattern finds in a report (admins)', async () => {
    const c = await owner()
    const reportUrl = `${jenkins.url}/job/platform/job/hit-suite/7/artifact/reports/hit.html`
    const names = async (body: object) => (await c.post(`/api/projects/${projectId}/test-report/preview`, body)).body.failedTests.map((t: any) => t.name)
    expect(await names({ reportUrl })).toEqual([
      'HIT-Checkout timeout',
      'test_export_ABC_42',
      'HIT-Search filters',
      'HIT-No bug yet',
    ])
    // A row reads "HIT-Checkout timeout FAIL 30 s".
    expect(await names({ reportUrl, pattern: String.raw`^(HIT-.+?) FAIL` })).toEqual([
      'HIT-Checkout timeout',
      'HIT-Search filters',
      'HIT-No bug yet',
    ])
    expect((await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl, pattern: '(' })).status).toBe(422)
    expect((await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl: 'https://elsewhere.example.com/r.html' })).status).toBe(422)
  })

  it("reads Gauge reports published as HTML_20Report (build page link, result data, the job's latest)", async () => {
    const c = await owner()
    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_GAUGE', version: '12.5.0', planned_deployment_date: '2031-05-01' })).body
    await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/qa/job/gauge-hit/5/`, purpose: 'HIT' })
    await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/qa/job/gauge-load/3/`, purpose: 'LOAD_TEST' })
    expect(await process(release.id)).toEqual({ done: 2, failed: 0 })
    const byReport = Object.fromEntries(
      (await c.get(`/api/releases/${release.id}/test-analyses`)).body.map((a: any) => [
        a.result.reportUrl.replace(jenkins.url, ''),
        a.result.failedTests.map((t: any) => `${t.name} → ${t.bugs.map((b: any) => b.key).join(',') || 'no bug'}`),
      ]),
    )
    // Looked up by the script (the spec's folder: specs/TC_101/case.html), not the scenario.
    expect(byReport).toEqual({
      '/job/qa/job/gauge-hit/5/HTML_20Report/index.html': ['Checkout: HIT-Checkout timeout → ABC-300', 'Search: HIT-Search filters → ABC-201'],
      '/job/qa/job/gauge-load/3/HTML_20Report/index.html': ['Load: test_export_ABC_42 → ABC-42'],
    })

    // Only the job-level report exists: used as the latest.
    const other = (await c.post('/api/releases', { project_id: projectId, name: 'RC_LATEST', version: '12.6.0', planned_deployment_date: '2031-05-08' })).body
    await c.post(`/api/releases/${other.id}/jenkins/followed`, { url: `${jenkins.url}/job/qa/job/gauge-latest/8/`, purpose: 'HIT' })
    await process(other.id)
    const [latest] = (await c.get(`/api/releases/${other.id}/test-analyses`)).body
    expect(latest.result.reportUrl).toBe(`${jenkins.url}/job/qa/job/gauge-latest/HTML_20Report/index.html`)
    expect(latest.result.failedTests.map((t: any) => t.name)).toEqual(['Search: HIT-No bug yet'])

    const hit = (await c.get(`/api/releases/${release.id}/test-analyses`)).body.find((a: any) => a.result.reportUrl.includes('gauge-hit'))
    expect(hit.result.failedTests.map((t: any) => `${t.script} ${t.bugs.map((b: any) => `${b.key} (${b.via})`)}`)).toEqual([
      'TC_101 ABC-300 (mentions TC_101)', // not ABC-301, which mentions TC_1010
      'TC_102 ABC-201 (linked to test case ABC-200, which mentions TC_102)', // the test case is labelled TC_102
    ])
    // Result data: the spec's file, and tags that look like IDs.
    const load = (await c.get(`/api/releases/${release.id}/test-analyses`)).body.find((a: any) => a.result.reportUrl.includes('gauge-load'))
    expect(load.result.failedTests[0]).toMatchObject({ script: 'TC_104', ids: ['TC_104', 'TC-9001'] })

    // The settings "Test" tool reads the same way (from the HTML_20Report/ link).
    expect((await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl: `${jenkins.url}/job/qa/job/gauge-hit/5/HTML_20Report/` })).body.failedTests).toEqual([
      { name: 'Checkout: HIT-Checkout timeout', script: 'TC_101', ids: ['TC_101'] },
      { name: 'Search: HIT-Search filters', script: 'TC_102', ids: ['TC_102'] },
    ])
  })

  it('uses a pasted report link when the report is elsewhere', async () => {
    const c = await owner()
    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_PASTE', version: '12.7.0', planned_deployment_date: '2031-05-15' })).body
    jenkins.jobs.get('perf/load-test')!.push({ number: 70, result: 'FAILURE', building: false })
    const run = (await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/perf/job/load-test/70/`, purpose: 'LOAD_TEST' })).body
    await process(release.id)
    const [nothing] = (await c.get(`/api/releases/${release.id}/test-analyses`)).body
    expect(nothing.state).toBe('failed')
    expect(nothing.error).toMatch(/^No report found \(looked at: no \.html artifact; .*\)\. Paste the report’s link below/)

    const reportUrl = `${jenkins.url}/job/qa/job/gauge-hit/5/HTML_20Report/`
    expect((await c.post(`/api/jenkins/followed/${run.id}/analyze`, { reportUrl })).status).toBe(202)
    const [found] = (await c.get(`/api/releases/${release.id}/test-analyses`)).body
    expect(found.state).toBe('done')
    expect(found.result.failedTests).toHaveLength(2)
  })

  it("follows HTML Publisher's frame to Jenkins' resource address (no credentials) and reads the data scripts", async () => {
    const c = await owner()
    const reportUrl = `${jenkins.url}/job/qa/job/gauge-spa/9/HTML_20Report/`
    const preview = (await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl })).body
    expect(preview.failedTests).toEqual([{ name: 'Checkout: HIT-Checkout timeout', script: 'TC_101', ids: ['TC_101'] }])
    expect(preview.how.join('\n')).toMatch(/fetched without credentials[\s\S]*Found Gauge's result data in data\/result\.js: 1 failed scenario/)

    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_SPA', version: '12.8.0', planned_deployment_date: '2031-05-22' })).body
    await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/qa/job/gauge-spa/9/`, purpose: 'HIT' })
    await process(release.id)
    const [a] = (await c.get(`/api/releases/${release.id}/test-analyses`)).body
    expect(a.result.failedTests.map((t: any) => `${t.name} → ${t.bugs.map((b: any) => b.key).join(',')}`)).toEqual(['Checkout: HIT-Checkout timeout → ABC-300'])
  })

  it('keeps what arrived when a spec page download is cut off, and names specs from the overview', async () => {
    const c = await owner()
    const reportUrl = `${jenkins.url}/job/qa/job/gauge-cut/4/HTML_20Report/index.html`
    const preview = (await c.post(`/api/projects/${projectId}/test-report/preview`, { reportUrl })).body
    expect(preview.failedTests).toEqual([
      { name: 'Export spec: CSV export', script: 'export', ids: ['export'] },
      { name: 'Search spec', script: 'search', ids: ['search'] },
    ])
    const how = preview.how.join('\n')
    expect(how).toMatch(/Export spec \(script export\): 1 failed scenario found \(page incomplete: the connection closed after 0\.\d MB\)/)
    expect(how).toMatch(/Search spec \(script search\): couldn't be read \(.*\), listed by the spec name/)
  })

  it("uses the link on the release's HIT report card, and says why a link on another server can't be used", async () => {
    const c = await owner()
    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_CARD', version: '12.9.0', planned_deployment_date: '2031-05-29' })).body
    jenkins.jobs.get('perf/load-test')!.push({ number: 80, result: 'FAILURE', building: false })
    const run = (await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/perf/job/load-test/80/`, purpose: 'HIT' })).body
    await process(release.id)
    expect((await c.get(`/api/releases/${release.id}/test-analyses`)).body[0].state).toBe('failed')

    // Elsewhere: refused, with both addresses.
    await c.post(`/api/jenkins/followed/${run.id}/analyze`, { reportUrl: 'https://reports.example.com/hit/index.html' })
    const [refused] = (await c.get(`/api/releases/${release.id}/test-analyses`)).body
    expect(refused.error).toContain(`the pasted link https://reports.example.com/hit/index.html: it is on reports.example.com, but the connected Jenkins is ${new URL(jenkins.url).host}`)

    // The report card's link (Reports step) is checked as soon as it's set.
    const card = (await c.get(`/api/releases/${release.id}`)).body.reports.find((r: any) => r.report_type === 'HIT')
    expect((await c.patch(`/api/reports/${card.id}`, { report_url: `${jenkins.url}/job/qa/job/gauge-hit/5/HTML_20Report/` })).status).toBe(204)
    expect((await c.get(`/api/releases/${release.id}/test-analyses`)).body[0].state).toBe('pending')
    await process(release.id)
    const [found] = (await c.get(`/api/releases/${release.id}/test-analyses`)).body
    expect(found.state).toBe('done')
    expect(found.result.failedTests.map((t: any) => t.script)).toEqual(['TC_101', 'TC_102'])
  })
})
