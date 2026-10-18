import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COMPANY_CA, fakeJenkins, fakeJira, JENKINS, JIRA } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

/** Jira + Jenkins integrations against fake servers (local test DB only). */
describe.skipIf(remote)('integrations', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jira: Awaited<ReturnType<typeof fakeJira>>
  let jenkins: Awaited<ReturnType<typeof fakeJenkins>>
  const owner = () => {
    const c = client(server.base)
    return c.login('charbel@example.com').then(() => c)
  }
  let projectId: string

  beforeAll(async () => {
    ;[server, jira, jenkins] = await Promise.all([startServer(), fakeJira(), fakeJenkins()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Integrations ${Date.now()}`, sprintsEnabled: false })).body.id
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jira?.close(), jenkins?.close()])
  })

  it('connects Jira (Cloud) after testing credentials; never returns the secret', async () => {
    const c = await owner()
    const bad = await c.put(`/api/projects/${projectId}/integrations/jira`, {
      authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: 'wrong-token', projectKey: 'abc',
    })
    expect(bad.status).toBe(502)
    expect(bad.body.error.message).toMatch(/rejected the credentials/)

    const missingKey = await c.put(`/api/projects/${projectId}/integrations/jira`, {
      authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: JIRA.token, projectKey: 'NOPE',
    })
    expect(missingKey.status).toBe(502)

    const ok = await c.put(`/api/projects/${projectId}/integrations/jira`, {
      authType: 'JIRA_CLOUD', baseUrl: `${jira.url}/`, username: JIRA.email, secret: JIRA.token, projectKey: 'abc',
    })
    expect(ok.status).toBe(200)
    expect(ok.body.message).toBe('Connected as Release Bot · project Alpha Product (ABC)')

    const list = (await c.get(`/api/projects/${projectId}/integrations`)).body
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'JIRA', base_url: jira.url, settings: { projectKey: 'ABC' } })
    expect(JSON.stringify(list)).not.toContain(JIRA.token)
    expect(list[0].secret_encrypted).toBeUndefined()

    // Re-saving without a secret keeps the stored one.
    expect((await c.put(`/api/projects/${projectId}/integrations/jira`, {
      authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, projectKey: 'ABC',
    })).status).toBe(200)
    expect((await c.post(`/api/projects/${projectId}/integrations/jira/test`)).body.message).toBe('Connected as Release Bot')
  })

  it('lists Jira versions, imports releases and shows their issues', async () => {
    const c = await owner()
    const versions = (await c.get(`/api/projects/${projectId}/jira/versions`)).body
    expect(versions.map((v: any) => v.name)).toEqual(['1.4.0', '1.5.0', '1.3.0'])

    const imported = await c.post(`/api/projects/${projectId}/jira/import`, { versionIds: ['10001', '10002'] })
    expect(imported.status).toBe(201)
    expect(imported.body.created).toHaveLength(2)
    // Importing again skips already-linked versions.
    expect((await c.post(`/api/projects/${projectId}/jira/import`, { versionIds: ['10001'] })).body.created).toHaveLength(0)

    const linked = (await c.get(`/api/projects/${projectId}/jira/versions`)).body.find((v: any) => v.id === '10001')
    expect(linked.release.name).toBe('1.4.0')
    const release = (await c.get(`/api/releases/${linked.release.id}`)).body
    expect(release).toMatchObject({ version: '1.4.0', planned_deployment_date: '2030-03-01', description: 'Search revamp' })

    // Cloud search paginates (150 issues over two pages).
    const issues = (await c.get(`/api/releases/${linked.release.id}/jira/issues`)).body
    expect(issues.linked).toBe(true)
    expect(issues.issues).toHaveLength(150)
    expect(issues.issues[0]).toMatchObject({ key: 'ABC-1', type: 'Story', statusCategory: 'new', url: `${jira.url}/browse/ABC-1` })
    expect(issues.issues.filter((i: any) => i.statusCategory === 'done')).toHaveLength(50)

    // Unlink / relink.
    expect((await c.put(`/api/releases/${linked.release.id}/jira`, { versionId: null })).status).toBe(204)
    expect((await c.get(`/api/releases/${linked.release.id}/jira/issues`)).body).toEqual({ linked: false })
    expect((await c.put(`/api/releases/${linked.release.id}/jira`, { versionId: '99999' })).status).toBe(404)
    expect((await c.put(`/api/releases/${linked.release.id}/jira`, { versionId: '10001' })).status).toBe(204)
  })

  it('supports Jira Server / Data Center (personal access token, offset pagination)', async () => {
    const c = await owner()
    const p = (await c.post('/api/projects', { name: `Jira DC ${Date.now()}`, sprintsEnabled: false })).body.id
    const saved = await c.put(`/api/projects/${p}/integrations/jira`, {
      authType: 'JIRA_SERVER', baseUrl: jira.url, secret: JIRA.pat, projectKey: 'ABC',
    })
    expect(saved.status).toBe(200)
    const [id] = (await c.post(`/api/projects/${p}/jira/import`, { versionIds: ['10001'] })).body.created
    expect((await c.get(`/api/releases/${id}/jira/issues`)).body.issues).toHaveLength(150)
    await c.del(`/api/projects/${p}`)
  })

  it('drives the Automated jobs step and report URLs from Jenkins, and runs jobs', async () => {
    const c = await owner()
    const connected = await c.put(`/api/projects/${projectId}/integrations/jenkins`, {
      authType: 'JENKINS', baseUrl: jenkins.url, username: JENKINS.user, secret: JENKINS.token,
    })
    expect(connected.body.message).toBe('Connected to Jenkins 2.462 as ci-bot')

    const release = (await c.post('/api/releases', { project_id: projectId, name: 'RC_J', version: '9.1.0', planned_deployment_date: '2030-04-01' })).body
    const step = async () => (await c.get(`/api/releases/${release.id}`)).body.tasks.find((t: any) => t.task_type === 'AUTOMATED_JOBS')

    // Unknown job → clear error, nothing linked.
    const missing = await c.post(`/api/releases/${release.id}/jenkins`, { jobPath: 'platform/nope', purpose: 'AUTOMATED' })
    expect(missing.status).toBe(502)
    expect(missing.body.error.message).toMatch(/not found/)

    // Linking accepts a full job URL; the latest build (#41 FAILURE) blocks the step.
    const linked = await c.post(`/api/releases/${release.id}/jenkins`, {
      jobPath: `${jenkins.url}/job/platform/job/integration-tests/`,
      purpose: 'AUTOMATED',
      parameters: { RC_VERSION: '{{version}}', TARGET: 'staging' },
    })
    expect(linked.status).toBe(201)
    expect(await step()).toMatchObject({ status: 'BLOCKED', blocker_reason: 'Jenkins: platform/integration-tests #41 failure' })

    // Run → parameters templated → build in progress → step in progress.
    expect((await c.post(`/api/jenkins/jobs/${linked.body.id}/run`)).status).toBe(202)
    expect(jenkins.triggered.at(-1)).toEqual({ job: 'platform/integration-tests', params: { RC_VERSION: '9.1.0', TARGET: 'staging' } })
    await c.post(`/api/releases/${release.id}/jenkins/sync`)
    expect((await step()).status).toBe('IN_PROGRESS')

    // Build passes → step completed, attributed to Jenkins in the activity log.
    jenkins.finish('platform/integration-tests', 'SUCCESS')
    expect((await c.post(`/api/releases/${release.id}/jenkins/sync`)).body).toEqual({ synced: 1, failed: 0 })
    expect((await step()).status).toBe('COMPLETED')
    const activity = (await c.get(`/api/releases/${release.id}/activity`)).body.map((a: any) => a.description)
    expect(activity).toEqual(expect.arrayContaining(['Jenkins: platform/integration-tests #42 success', 'started Jenkins job platform/integration-tests']))

    // Report job: HTML artifact becomes the HIT report URL (not the result: humans review).
    await c.post(`/api/releases/${release.id}/jenkins`, { jobPath: 'platform/hit-suite', purpose: 'HIT' })
    const hit = (await c.get(`/api/releases/${release.id}`)).body.reports.find((r: any) => r.report_type === 'HIT')
    expect(hit.report_url).toBe(`${jenkins.url}/job/platform/job/hit-suite/7/artifact/reports/hit.html`)
    expect(hit.result).toBe('NOT_REVIEWED')

    const jobs = (await c.get(`/api/releases/${release.id}/jenkins`)).body
    expect(jobs.map((j: any) => [j.job_path, j.purpose, j.last_build.result])).toEqual([
      ['platform/integration-tests', 'AUTOMATED', 'SUCCESS'],
      ['platform/hit-suite', 'HIT', 'SUCCESS'],
    ])
    const builds = (await c.get(`/api/jenkins/jobs/${linked.body.id}/builds`)).body
    expect(builds.map((b: any) => b.number)).toEqual([42, 41])
  })

  it('enforces roles: viewers read, members run, admins configure', async () => {
    const c = await owner()
    const maya = client(server.base)
    const mayaUser = await maya.login('maya@example.com')
    await c.post(`/api/projects/${projectId}/invitations/email`, { email: 'maya@example.com', role: 'VIEWER' })
    const release = (await c.get(`/api/releases?projectId=${projectId}`)).body.find((r: any) => r.name === 'RC_J')
    const jobs = (await maya.get(`/api/releases/${release.id}/jenkins`)).body
    expect(jobs).toHaveLength(2) // viewer can see
    expect((await maya.get(`/api/releases/${release.id}/jira/issues`)).status).toBe(200)
    expect((await maya.post(`/api/jenkins/jobs/${jobs[0].id}/run`)).status).toBe(403)
    expect((await maya.post(`/api/releases/${release.id}/jenkins`, { jobPath: 'platform/hit-suite', purpose: 'OTHER' })).status).toBe(403)
    expect((await maya.del(`/api/jenkins/jobs/${jobs[0].id}`)).status).toBe(403)

    await c.put(`/api/projects/${projectId}/members/${mayaUser.id}`, { role: 'MEMBER' })
    expect((await maya.post(`/api/jenkins/jobs/${jobs[0].id}/run`)).status).toBe(202)
    expect((await maya.put(`/api/projects/${projectId}/integrations/jenkins`, {
      authType: 'JENKINS', baseUrl: jenkins.url, username: 'x', secret: 'y',
    })).status).toBe(403)
    expect((await maya.del(`/api/projects/${projectId}/integrations/jira`)).status).toBe(403)
    expect((await maya.post(`/api/projects/${projectId}/integrations/inspect-certificate`, { baseUrl: 'https://example.com' })).status).toBe(403)

    // Outsiders see nothing.
    const omar = client(server.base)
    await omar.login('omar@example.com')
    expect((await omar.get(`/api/projects/${projectId}/integrations`)).body).toEqual([])
    expect((await omar.get(`/api/releases/${release.id}/jenkins`)).status).toBe(404)
  })

  it('trusts a pasted company certificate (SELF_SIGNED_CERT_IN_CHAIN)', async () => {
    const corp = await fakeJira({ https: true })
    try {
      const c = await owner()
      const p = (await c.post('/api/projects', { name: `Corp TLS ${Date.now()}`, sprintsEnabled: false })).body.id
      const base = { authType: 'JIRA_SERVER', baseUrl: corp.url, secret: JIRA.pat, projectKey: 'ABC' }

      // Without the company CA: refused, with an actionable message.
      const untrusted = await c.put(`/api/projects/${p}/integrations/jira`, base)
      expect(untrusted.status).toBe(502)
      expect(untrusted.body.error.message).toMatch(/SELF_SIGNED_CERT_IN_CHAIN/)
      expect(untrusted.body.error.message).toMatch(/Company HTTPS certificate/)

      // Garbage isn't accepted as a certificate.
      expect((await c.put(`/api/projects/${p}/integrations/jira`, { ...base, caCert: 'hello' })).status).toBe(422)

      // Admins can read the chain the server presents and pick its root.
      const inspected = await c.post(`/api/projects/${p}/integrations/inspect-certificate`, { baseUrl: corp.url })
      expect(inspected.status).toBe(200)
      const root = inspected.body.certificates[inspected.body.recommended]
      expect(root).toMatchObject({ subject: 'Test Company Root CA', issuer: 'Test Company Root CA', selfSigned: true })
      expect(inspected.body.certificates[0].subject).toBe('localhost')
      // The fetched root is enough to connect.
      expect((await c.put(`/api/projects/${p}/integrations/jira`, { ...base, caCert: root.pem })).status).toBe(200)

      // With the company CA: connects; verification stays on.
      const trusted = await c.put(`/api/projects/${p}/integrations/jira`, { ...base, caCert: COMPANY_CA })
      expect(trusted.status).toBe(200)
      const saved = (await c.get(`/api/projects/${p}/integrations`)).body[0]
      expect(saved.ca_cert).toContain('BEGIN CERTIFICATE')

      // Kept when re-saving without it; used for every later call.
      expect((await c.put(`/api/projects/${p}/integrations/jira`, base)).status).toBe(200)
      expect((await c.get(`/api/projects/${p}/jira/versions`)).body.map((v: any) => v.name)).toContain('1.4.0')

      // Removing it brings the error back.
      expect((await c.put(`/api/projects/${p}/integrations/jira`, { ...base, caCert: '' })).status).toBe(502)
      await c.del(`/api/projects/${p}`)
    } finally {
      await corp.close()
    }
  })

  it('rejects unsafe input', async () => {
    const c = await owner()
    const creds = { authType: 'JENKINS', username: JENKINS.user, secret: JENKINS.token }
    expect((await c.put(`/api/projects/${projectId}/integrations/jenkins`, { ...creds, baseUrl: 'ftp://x' })).status).toBe(422)
    expect((await c.put(`/api/projects/${projectId}/integrations/jenkins`, { ...creds, baseUrl: 'https://u:p@jenkins.example' })).status).toBe(422)
    const release = (await c.get(`/api/releases?projectId=${projectId}`)).body[0]
    expect((await c.post(`/api/releases/${release.id}/jenkins`, { jobPath: '../../etc', purpose: 'OTHER' })).status).toBe(422)
    expect((await c.post(`/api/releases/${release.id}/jenkins`, { jobPath: 'x', purpose: 'OTHER', parameters: { 'bad key!': 'v' } })).status).toBe(400)
  })

  it('follows a pasted build link with the status of every build it started', async () => {
    const c = await owner()
    const p = (await c.post('/api/projects', { name: `Followed ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${p}/integrations/jenkins`, { authType: 'JENKINS', baseUrl: jenkins.url, username: JENKINS.user, secret: JENKINS.token })
    const release = (await c.post('/api/releases', { project_id: p, name: 'RC_F', version: '9.2.0', planned_deployment_date: '2030-04-01' })).body

    // Running pipeline → its three downstream jobs (one queued), and their own downstream build.
    const followed = await c.post(`/api/releases/${release.id}/jenkins/followed`, {
      url: `${jenkins.url}/job/release/job/orchestrator/5/console`,
      label: 'Release pipeline',
    })
    expect(followed.status).toBe(201)
    expect(followed.body).toMatchObject({ job_path: 'release/orchestrator', build_number: 5, label: 'Release pipeline' })
    const tree = followed.body.status
    expect(tree).toMatchObject({ name: 'release » orchestrator #5', building: true, result: null, estimatedDuration: 120000 })
    expect(tree.children.map((ch: any) => [ch.name, ch.result, ch.queued])).toEqual([
      ['platform » integration-tests #41', 'FAILURE', false],
      ['platform » hit-suite #7', 'SUCCESS', false],
      ['platform/deploy (waiting in queue)', null, true],
    ])
    expect(tree.children[1].children.map((ch: any) => ch.name)).toEqual(['platform » report-publisher #2'])

    // Same build twice → a clear conflict.
    const again = await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/release/job/orchestrator/5/` })
    expect(again.status).toBe(409)
    expect(again.body.error.message).toBe('This build is already followed on this release.')

    // A job link follows its latest run; downstream builds come from the console log.
    const legacy = await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/legacy/job/umbrella/` })
    expect(legacy.body).toMatchObject({ build_number: 3, status: { result: 'FAILURE' } })
    expect(legacy.body.status.children.map((ch: any) => ch.name)).toEqual(['platform » report-publisher #2'])

    // Refresh picks up the finished build and stores it.
    jenkins.finish('release/orchestrator', 'SUCCESS')
    const refreshed = await c.post(`/api/jenkins/followed/${followed.body.id}/refresh`)
    expect(refreshed.status).toBe(200)
    expect(refreshed.body).toMatchObject({ last_error: null, status: { building: false, result: 'SUCCESS' } })

    const list = (await c.get(`/api/releases/${release.id}/jenkins/followed`)).body
    expect(list.map((f: any) => f.job_path)).toEqual(['release/orchestrator', 'legacy/umbrella'])

    // Bad links.
    const elsewhere = await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: 'https://other.example.com/job/a/1/' })
    expect(elsewhere.status).toBe(422)
    const missing = await c.post(`/api/releases/${release.id}/jenkins/followed`, { url: `${jenkins.url}/job/release/job/orchestrator/99/` })
    expect(missing.status).toBe(502)

    expect((await c.del(`/api/jenkins/followed/${legacy.body.id}`)).status).toBe(204)
    expect((await c.get(`/api/releases/${release.id}/jenkins/followed`)).body).toHaveLength(1)
    await c.del(`/api/projects/${p}`)
  })
})
