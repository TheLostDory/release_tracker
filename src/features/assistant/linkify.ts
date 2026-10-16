import { safeHttpUrl } from '@/lib/safe-url'
import type { ChatSource } from './api'

export type Segment = { text: string; href?: undefined } | { text: string; href: string }

const KEY = /\b[A-Z][A-Z0-9_]{1,19}-\d{1,9}\b/g

/**
 * Splits an answer into text and links: issue keys the answer was based on
 * link to Jira. Only URLs from the server's sources are used (http(s) only),
 * never URLs written by the model.
 */
export function linkify(text: string, sources: ChatSource[]): Segment[] {
  const links = new Map<string, string>()
  for (const s of sources) {
    const href = s.kind === 'jira_issue' ? safeHttpUrl(s.url) : null
    if (href) links.set(s.label, href)
  }
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(KEY)) {
    const href = links.get(m[0])
    if (!href) continue
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[0], href })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** The conversation sent with a new question: the last few turns, within the server's limits. */
export function conversationFor(history: { role: 'user' | 'assistant'; content: string }[], question: string) {
  return [...history.slice(-10), { role: 'user' as const, content: question }].map((m) => ({ ...m, content: m.content.slice(0, 4000) }))
}
