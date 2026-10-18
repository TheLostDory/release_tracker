import { describe, expect, it } from 'vitest'
import { codeCheckState, type CodeCheckCounts } from './code-check'

const counts = (over: Partial<CodeCheckCounts> = {}): CodeCheckCounts => ({
  jira_only: 0,
  jira_only_done: 0,
  code_only: 0,
  no_key: 0,
  matched: 12,
  has_jira: true,
  error: null,
  ...over,
})

describe('codeCheckState', () => {
  it('is unchecked until compared', () => {
    expect(codeCheckState(null)).toEqual({ kind: 'unchecked' })
  })

  it('matches when nothing differs', () => {
    expect(codeCheckState(counts())).toEqual({ kind: 'match' })
  })

  it('counts every kind of difference and says which', () => {
    expect(codeCheckState(counts({ jira_only: 3, jira_only_done: 1, code_only: 2, no_key: 1 }))).toEqual({
      kind: 'differs',
      differences: 6,
      parts: ['3 in Jira not merged (1 marked Done)', '2 merged not in the version', '1 merged without an issue'],
    })
  })

  it('reports errors and a missing Jira link before anything else', () => {
    expect(codeCheckState(counts({ error: 'acme/app: branch not found', jira_only: 4 }))).toEqual({ kind: 'error', message: 'acme/app: branch not found' })
    expect(codeCheckState(counts({ has_jira: false, no_key: 2 }))).toEqual({ kind: 'no_jira' })
  })
})
