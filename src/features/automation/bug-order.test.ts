import { describe, expect, it } from 'vitest'
import type { FoundBug } from './api'
import { byStatus } from './bug-order'

const bug = (key: string, status: string, statusCategory = 'indeterminate'): FoundBug => ({ key, status, statusCategory, summary: '', type: 'Bug', url: '', via: '' })

describe('bugs of a failed test', () => {
  it('lists Done, Dropped and Production Ready bugs last', () => {
    const bugs = [bug('A-1', 'Done', 'done'), bug('A-2', 'Open', 'new'), bug('A-3', 'Dropped'), bug('A-4', 'In Progress'), bug('A-5', 'Production Ready'), bug('A-6', 'Closed', 'done')]
    expect(byStatus(bugs).map((b) => b.key)).toEqual(['A-2', 'A-4', 'A-1', 'A-3', 'A-5', 'A-6'])
  })
})
