import { describe, expect, it } from 'vitest'
import type { JiraVersion } from './api'
import { filterVersions } from './jira-versions'

const v = (name: string, over: Partial<JiraVersion> = {}): JiraVersion => ({
  id: name,
  name,
  released: false,
  archived: false,
  releaseDate: null,
  description: null,
  release: null,
  ...over,
})

const versions = [
  v('2026.10 Payments', { releaseDate: '2026-10-20', description: 'Card provider migration' }),
  v('2026.11 Search', { releaseDate: '2026-11-05' }),
  v('2026.09 Hotfix', { released: true, releaseDate: '2026-09-01' }),
  v('Backlog'),
  v('Old', { archived: true }),
]

describe('filterVersions', () => {
  it('hides archived and released by default, soonest first, undated last', () => {
    expect(filterVersions(versions, '', false).map((x) => x.name)).toEqual(['2026.10 Payments', '2026.11 Search', 'Backlog'])
  })

  it('matches every word, case-insensitive, in name or description', () => {
    expect(filterVersions(versions, 'PAY', false).map((x) => x.name)).toEqual(['2026.10 Payments'])
    expect(filterVersions(versions, 'card migration', false).map((x) => x.name)).toEqual(['2026.10 Payments'])
    expect(filterVersions(versions, '2026 search', false).map((x) => x.name)).toEqual(['2026.11 Search'])
    expect(filterVersions(versions, 'nothing-like-this', false)).toEqual([])
  })

  it('includes released versions when asked (after unreleased)', () => {
    expect(filterVersions(versions, '2026', true).map((x) => x.name)).toEqual(['2026.10 Payments', '2026.11 Search', '2026.09 Hotfix'])
  })
})
