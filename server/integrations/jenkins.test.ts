import { describe, expect, it } from 'vitest'
import { parseBuildUrl } from './jenkins.js'

describe('parseBuildUrl', () => {
  const base = 'https://ci.example.com/jenkins'

  it('reads classic build links, with whatever page comes after the number', () => {
    expect(parseBuildUrl(`${base}/job/release/job/orchestrator/5/`, base)).toEqual({ jobPath: 'release/orchestrator', build: 5 })
    expect(parseBuildUrl(`${base}/job/release/job/orchestrator/5/console`, base)).toEqual({ jobPath: 'release/orchestrator', build: 5 })
    expect(parseBuildUrl(`${base}/job/a%20b/12/pipeline-console/?selected-node=7`, base)).toEqual({ jobPath: 'a b', build: 12 })
  })

  it('treats a job link or a permalink as "its latest run"', () => {
    expect(parseBuildUrl(`${base}/job/release/job/orchestrator/`, base)).toEqual({ jobPath: 'release/orchestrator', build: null })
    expect(parseBuildUrl(`${base}/job/release/job/orchestrator/lastBuild/`, base)).toEqual({ jobPath: 'release/orchestrator', build: 'lastBuild' })
  })

  it('reads Blue Ocean links, including multibranch branches', () => {
    expect(parseBuildUrl(`${base}/blue/organizations/jenkins/release%2Forchestrator/detail/orchestrator/5/pipeline`, base)).toEqual({
      jobPath: 'release/orchestrator',
      build: 5,
    })
    expect(parseBuildUrl(`${base}/blue/organizations/jenkins/app/detail/main/9/pipeline/`, base)).toEqual({ jobPath: 'app/main', build: 9 })
  })

  it('rejects links that are not on the connected Jenkins', () => {
    expect(() => parseBuildUrl('https://evil.example.com/jenkins/job/a/1/', base)).toThrow(/not on the connected Jenkins/)
    expect(() => parseBuildUrl('https://ci.example.com/other/job/a/1/', base)).toThrow(/not on the connected Jenkins/)
    expect(() => parseBuildUrl('release/orchestrator #5', base)).toThrow(/full link/)
    expect(() => parseBuildUrl(`${base}/view/all/`, base)).toThrow(/\/job\//)
  })
})
