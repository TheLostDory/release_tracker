import { describe, expect, it } from 'vitest'
import type { BuildNode } from './api'
import { buildProgress, summarizeDownstream, summaryText } from './followed-builds'

const node = (over: Partial<BuildNode>): BuildNode => ({
  jobPath: 'a',
  number: 1,
  name: 'a #1',
  url: 'https://ci/job/a/1/',
  result: 'SUCCESS',
  building: false,
  queued: false,
  timestamp: 0,
  duration: 1000,
  estimatedDuration: 1000,
  children: [],
  ...over,
})

describe('summarizeDownstream', () => {
  it('counts every level below the build, by state', () => {
    const tree = node({
      building: true,
      result: null,
      children: [
        node({ result: 'FAILURE' }),
        node({ children: [node({ result: 'SUCCESS' }), node({ building: true, result: null })] }),
        node({ queued: true, number: null, result: null }),
      ],
    })
    const s = summarizeDownstream(tree)
    expect(s).toEqual({ total: 5, passed: 2, failed: 1, running: 1, queued: 1 })
    expect(summaryText(s)).toBe('5 downstream builds: 2 passed · 1 failed · 1 running · 1 queued')
  })

  it('says nothing when the build started no others', () => {
    expect(summaryText(summarizeDownstream(node({})))).toBe('')
  })
})

describe('buildProgress', () => {
  it('uses Jenkins’ estimate, never showing 100 % while running', () => {
    expect(buildProgress(node({ building: true, timestamp: 0, estimatedDuration: 200 }), 50)).toBe(25)
    expect(buildProgress(node({ building: true, timestamp: 0, estimatedDuration: 200 }), 500)).toBe(99)
    expect(buildProgress(node({ building: false }), 50)).toBeNull()
    expect(buildProgress(node({ building: true, estimatedDuration: null }), 50)).toBeNull()
  })
})
