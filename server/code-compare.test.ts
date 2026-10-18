import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fakeGitHub, fakeJira, GITHUB, JIRA } from './test/fakes.js'
import { client, remote, startServer } from './test/harness.js'

/** RC vs Jira version: merged pull requests/commits compared with the version's issues. */
describe.skipIf(remote)('code comparison', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let jira: Awaited<ReturnType<typeof fakeJira>>
  let github: Awaited<ReturnType<typeof fakeGitHub>>
  let projectId: string
  const owner = async () => {
    const c = client(server.base)
    await c.login('charbel@example.com')
    return c
  }

  beforeAll(async () => {
    ;[server, jira, github] = await Promise.all([startServer(), fakeJira(), fakeGitHub()])
    const c = await owner()
    projectId = (await c.post('/api/projects', { name: `Compare ${Date.now()}`, sprintsEnabled: false })).body.id
    await c.put(`/api/projects/${projectId}/integrations/jira`, {
      authType: 'JIRA_CLOUD', baseUrl: jira.url, username: JIRA.email, secret: JIRA.token, projectKey: 'ABC',
    })
  })
  afterAll(async () => {
    await Promise.all([server?.stop(), jira?.close(), github?.close()])
  })

  it('connects GitHub after checking the token and every repository', async () => {
    const c = await owner()
    const save = (body: object) => c.put(`/api/projects/${projectId}/integrations/github`, { authType: 'GITHUB', baseUrl: github.url, ...body })
    const bad = await save({ secret: 'wrong', repos: ['acme/app'] })
    expect(bad.status).toBe(502)
    expect(bad.body.error.message).toMatch(/rejected the credentials.*Bad credentials/)
    const missing = await save({ secret: GITHUB.token, repos: ['acme/app', 'acme/nope'] })
    expect(missing.body.error.message).toBe("GitHub: repository acme/nope not found, or the token can't read it.")
    expect((await save({ secret: GITHUB.token, repos: ['not a repo'] })).status).toBe(422)

    const ok = await save({ secret: GITHUB.token, repos: ['acme/app'] })
    expect(ok.status).toBe(200)
    expect(ok.body.message).toBe('Connected as release-bot · 1 repository')
    const gh = (await c.get(`/api/projects/${projectId}/integrations`)).body.find((i: any) => i.kind === 'GITHUB')
    // A plain host gets the Enterprise API path; the default RC pattern is stored.
    expect(gh).toMatchObject({ base_url: `${github.url}/api/v3`, settings: { repos: ['acme/app'], headTemplate: 'release/{{version}}' } })
    expect(JSON.stringify(gh)).not.toContain(GITHUB.token)
  })

  it('compares the RC with the Jira version', async () => {
    const c = await owner()
    const [current, previous] = (await c.post(`/api/projects/${projectId}/jira/import`, { versionIds: ['10001', '10000'] })).body.created
    const nothingChosen = await c.get(`/api/releases/${current}/code-compare`)
    expect(nothingChosen.status).toBe(409)

    // The previous release's RC becomes the suggested base.
    expect((await c.put(`/api/releases/${previous}/code-refs`, { refs: [{ repo: 'acme/app', baseRef: 'release/1.2.0', headRef: 'release/1.3.0' }] })).status).toBe(204)
    const refs = (await c.get(`/api/releases/${current}/code-refs`)).body
    expect(refs).toMatchObject({
      connected: true,
      repos: ['acme/app'],
      refs: [],
      suggestions: [{ repo: 'acme/app', headRef: 'release/1.4.0', baseRef: 'release/1.3.0' }],
      previousRelease: { version: '1.3.0' },
    })
    expect((await c.put(`/api/releases/${current}/code-refs`, { refs: [{ repo: 'acme/other', baseRef: 'a', headRef: 'b' }] })).status).toBe(422)
    expect((await c.put(`/api/releases/${current}/code-refs`, { refs: [{ repo: 'acme/app', baseRef: 'a..b', headRef: 'b' }] })).status).toBe(400)
    expect((await c.put(`/api/releases/${current}/code-refs`, { refs: [refs.suggestions[0]] })).status).toBe(204)

    const r = await c.get(`/api/releases/${current}/code-compare`)
    expect(r.status).toBe(200)
    const cmp = r.body
    expect(cmp.jira).toMatchObject({ versionName: '1.4.0', truncated: false })
    // 112 commits over two pages.
    expect(cmp.repos).toEqual([
      expect.objectContaining({ repo: 'acme/app', baseRef: 'release/1.3.0', headRef: 'release/1.4.0', totalCommits: 112, truncated: false, error: null }),
    ])
    expect(cmp.matched.map((m: any) => [m.issue.key, m.changes.map((x: any) => `${x.ref} ${x.title}`)])).toEqual([
      ['ABC-1', ['#12 Login with SSO']],
      ['ABC-2', ['#13 ABC-2 Faster search']],
    ])
    expect(cmp.matched[0].changes[0]).toMatchObject({ kind: 'pr', branch: 'feature/abc-1-sso', author: 'maya', url: 'https://github.example/acme/app/pull/12' })
    expect(cmp.jiraOnly).toHaveLength(148)
    // Merged but not in 1.4.0: one planned for 1.5.0, one that doesn't exist.
    expect(cmp.codeOnly.map((x: any) => [x.key, x.jira?.fixVersions?.map((v: any) => v.name) ?? x.jira])).toEqual([
      ['ABC-155', ['1.5.0']],
      ['ABC-999', null],
    ])
    expect(cmp.noKey.map((x: any) => x.ref)).toEqual(['#14'])
    expect(cmp.otherCommits).toHaveLength(106)
    expect(cmp.syncMerges.map((x: any) => x.title)).toEqual(["Merge branch 'main' into release/1.4.0"])
    expect(cmp.notes).toEqual([])

    // The result is kept for the releases list (and the dashboard).
    const listed = (await c.get(`/api/releases?projectId=${projectId}`)).body.find((x: any) => x.id === current)
    expect(listed.code_check).toMatchObject({ jira_only: 148, jira_only_done: 50, code_only: 2, no_key: 1, matched: 2, has_jira: true, error: null })
    // Choosing other branches clears it until the next comparison.
    await c.put(`/api/releases/${current}/code-refs`, { refs: [refs.suggestions[0]] })
    expect((await c.get(`/api/releases?projectId=${projectId}`)).body.find((x: any) => x.id === current).code_check).toBeNull()
    await c.get(`/api/releases/${current}/code-compare`)

    // Cached: a second look doesn't call GitHub again; refresh does.
    const before = github.calls.length
    await c.get(`/api/releases/${current}/code-compare`)
    expect(github.calls.length).toBe(before)
    await c.get(`/api/releases/${current}/code-compare?refresh=true`)
    expect(github.calls.filter((u) => u.includes('/compare/')).length).toBeGreaterThan(2)
  })

  it('reports a branch that does not exist, and works without a Jira link', async () => {
    const c = await owner()
    const rel = (await c.post('/api/releases', { project_id: projectId, name: 'Unlinked', version: '2.0.0', planned_deployment_date: '2031-01-01' })).body
    await c.put(`/api/releases/${rel.id}/code-refs`, { refs: [{ repo: 'acme/app', baseRef: 'release/1.9.0', headRef: 'release/2.0.0' }] })
    const r = (await c.get(`/api/releases/${rel.id}/code-compare`)).body
    expect(r.jira).toBeNull()
    expect(r.notes).toEqual([
      "acme/app: GitHub: couldn't compare acme/app release/1.9.0...release/2.0.0. Check that both branches/tags exist.",
      'This release is not linked to a Jira version. Link it on the release page to compare.',
    ])
  })

  it('only members change what is compared', async () => {
    const viewer = client(server.base)
    await viewer.login('omar@example.com')
    const any = (await (await owner()).get(`/api/releases?projectId=${projectId}`)).body[0]
    expect((await viewer.get(`/api/releases/${any.id}/code-refs`)).status).toBe(404) // not a member of this project
  })
})
