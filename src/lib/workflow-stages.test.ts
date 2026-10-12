import { describe, expect, it } from 'vitest'
import { summarizeStages } from './workflow-stages'

describe('summarizeStages', () => {
  it('omits stages whose steps are turned off', () => {
    const stages = summarizeStages(
      [
        { task_type: 'RELEASE_IDENTIFIED', status: 'COMPLETED', planned_date: null },
        { task_type: 'HIT_REVIEW', status: 'IN_PROGRESS', planned_date: null },
        { task_type: 'DEPLOYMENT', status: 'NOT_STARTED', planned_date: null },
      ],
      'HIT_REVIEW',
    )
    expect(stages.map((s) => `${s.name}:${s.state}:${s.done}/${s.total}`)).toEqual([
      'Identified:done:1/1',
      'Reports:current:0/1',
      'Deployment:todo:0/1',
    ])
  })
})
