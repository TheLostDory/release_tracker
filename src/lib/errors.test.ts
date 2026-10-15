import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { isNotFound, toUserMessage } from './errors'

describe('toUserMessage', () => {
  it('uses the server message', () => {
    expect(toUserMessage(new ApiError(409, 'A release with this name already exists in this sprint.'))).toBe(
      'A release with this name already exists in this sprint.',
    )
  })
  it('falls back for unknown values', () => {
    expect(toUserMessage(null, 'fallback')).toBe('fallback')
  })
  it('detects not-found', () => {
    expect(isNotFound(new ApiError(404, 'x'))).toBe(true)
    expect(isNotFound(new ApiError(403, 'x'))).toBe(false)
  })
})
