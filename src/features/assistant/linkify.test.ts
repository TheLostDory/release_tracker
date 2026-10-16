import { describe, expect, it } from 'vitest'
import { conversationFor, linkify } from './linkify'

describe('linkify', () => {
  const sources = [
    { kind: 'jira_issue' as const, label: 'ABC-7', url: 'https://jira.example.com/browse/ABC-7' },
    { kind: 'jira_issue' as const, label: 'ABC-8', url: 'javascript:alert(1)' },
    { kind: 'release' as const, label: '1.4.0', url: '/releases/x' },
  ]

  it('links issue keys that came from the sources', () => {
    expect(linkify('ABC-7 shipped in 1.4.0; ABC-9 is unknown.', sources)).toEqual([
      { text: 'ABC-7', href: 'https://jira.example.com/browse/ABC-7' },
      { text: ' shipped in 1.4.0; ABC-9 is unknown.' },
    ])
  })

  it('never links unsafe URLs', () => {
    expect(linkify('See ABC-8.', sources)).toEqual([{ text: 'See ABC-8.' }])
  })

  it('keeps plain text as one segment', () => {
    expect(linkify('Nothing here', [])).toEqual([{ text: 'Nothing here' }])
  })
})

describe('conversationFor', () => {
  it('keeps the last 10 turns plus the question, trimmed to 4000 chars', () => {
    const history = Array.from({ length: 14 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: String(i) }))
    const out = conversationFor(history, 'q'.repeat(5000))
    expect(out).toHaveLength(11)
    expect(out[0]!.content).toBe('4')
    expect(out.at(-1)).toEqual({ role: 'user', content: 'q'.repeat(4000) })
  })
})
