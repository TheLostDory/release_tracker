import { describe, expect, it } from 'vitest'
import { toUserMessage } from './supabase-errors'

describe('toUserMessage', () => {
  it('maps known constraints', () => {
    expect(
      toUserMessage({
        code: '23505',
        message: 'duplicate key value violates unique constraint "releases_name_per_sprint_unique"',
      }),
    ).toBe('A release with this name already exists in this sprint.')
    expect(
      toUserMessage({
        code: '23503',
        message: 'update or delete on table "sprints" violates foreign key constraint "releases_sprint_id_fkey"',
      }),
    ).toBe('This sprint still has releases. Move or delete them first.')
  })

  it('falls back to generic code messages', () => {
    expect(toUserMessage({ code: '42501', message: 'new row violates row-level security policy' })).toBe(
      "You don't have permission to do that.",
    )
  })

  it('handles non-errors', () => {
    expect(toUserMessage(null, 'fallback')).toBe('fallback')
  })
})
