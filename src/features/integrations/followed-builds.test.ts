import { describe, expect, it } from 'vitest'
import type { BuildNode } from './api'
import { buildProgress, formatMinutes, summarizeDownstream, summaryText, timeLeftText } from './followed-builds'

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

describe('timeLeftText', () => {
  const running = (estimateMin: number) =>
    node({ building: true, result: null, timestamp: 0, estimatedDuration: estimateMin * 60_000 })
  it('says roughly how long is left, then how far past the usual time it is', () => {
    expect(timeLeftText(running(30), 18 * 60_000)).toBe('~12 min left')
    expect(timeLeftText(running(180), 50 * 60_000)).toBe('~2 h 10 min left')
    expect(timeLeftText(running(30), 34 * 60_000)).toBe('running 4 min longer than usual')
    expect(timeLeftText(node({}), 0)).toBeNull()
  })
  it('rounds to whole minutes, at least one', () => {
    expect(formatMinutes(10_000)).toBe('1 min')
    expect(formatMinutes(60 * 60_000)).toBe('1 h')
  })
})
