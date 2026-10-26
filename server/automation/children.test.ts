import { describe, expect, it } from 'vitest'
import type { BuildNode } from '../integrations/jenkins.js'
import { childPurpose, slotRuns } from './children.js'

const node = (jobPath: string, number: number | null, children: BuildNode[] = []): BuildNode => ({
  jobPath,
  number,
  name: `${jobPath} #${number}`,
  url: `https://ci/job/${jobPath}/${number}/`,
  result: null,
  building: true,
  queued: number === null,
  timestamp: 0,
  duration: 0,
  estimatedDuration: null,
  children,
})

describe('parent job children', () => {
  it('matches the listed jobs first, then the job name', () => {
    const jobs = [{ purpose: 'HIT', jobPath: 'qa/regression-suite' }]
    expect(childPurpose('qa/regression-suite', jobs)).toBe('HIT')
    expect(childPurpose('perf/Load-Test', [])).toBe('LOAD_TEST')
    expect(childPurpose('perf/loadtest-nightly', [])).toBe('LOAD_TEST')
    expect(childPurpose('qa/longevity', [])).toBe('LONGEVITY')
    expect(childPurpose('qa/soak-72h', [])).toBe('LONGEVITY')
    expect(childPurpose('qa/HIT_suite', [])).toBe('HIT')
    expect(childPurpose('qa/white-box', [])).toBeNull() // "hit" inside a word doesn't count
    expect(childPurpose('build/compile', [])).toBeNull()
  })

  it('takes the started runs (any depth), the latest per slot; queued ones wait', () => {
    const parent = node('release/rc-validation', 5, [
      node('perf/load-test', 9),
      node('stage/tests', 3, [node('qa/longevity', 20), node('qa/longevity', 21)]),
      node('qa/hit', null),
    ])
    expect(slotRuns(parent, [])).toEqual([
      { purpose: 'LOAD_TEST', jobPath: 'perf/load-test', number: 9 },
      { purpose: 'LONGEVITY', jobPath: 'qa/longevity', number: 21 },
    ])
  })
})
