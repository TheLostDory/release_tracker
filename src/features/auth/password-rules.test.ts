import { describe, expect, it } from 'vitest'
import { authErrorMessage, passwordProblem } from './password-rules'

describe('passwordProblem', () => {
  it('enforces length and letters + digits', () => {
    expect(passwordProblem('short1')).toMatch(/at least 10/)
    expect(passwordProblem('onlyletters')).toMatch(/letters and numbers/)
    expect(passwordProblem('1234567890')).toMatch(/letters and numbers/)
    expect(passwordProblem('release2026')).toBeNull()
  })
})

describe('authErrorMessage', () => {
  it('rewords known errors', () => {
    expect(authErrorMessage(new Error('User already registered'))).toMatch(/already exists/)
    expect(authErrorMessage(new Error('Invalid login credentials'))).toBe('Wrong email or password.')
    expect(authErrorMessage(new Error('Signups not allowed for this instance'))).toMatch(/turned off/)
  })
})
