import { describe, expect, it } from 'vitest'
import { describeNetworkError } from './outbound.js'

const withCause = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
const url = 'https://jira.corp.example/rest/api/2/myself'

describe('describeNetworkError', () => {
  it('names DNS, refused, certificate and timeout problems', () => {
    expect(describeNetworkError(withCause('ENOTFOUND'), url)).toMatch(/jira\.corp\.example doesn't resolve.*ENOTFOUND/)
    expect(describeNetworkError(withCause('ECONNREFUSED'), url)).toMatch(/refused the connection/)
    expect(describeNetworkError(withCause('SELF_SIGNED_CERT_IN_CHAIN'), url)).toMatch(/certificate this server doesn't trust/)
    expect(describeNetworkError(withCause('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), url)).toMatch(/certificate/)
    expect(describeNetworkError(Object.assign(new Error('t'), { name: 'TimeoutError' }), url)).toMatch(/did not answer within 15s/)
  })
  it('falls back to the raw reason', () => {
    expect(describeNetworkError(withCause('EPROTO'), url)).toMatch(/EPROTO/)
  })
})
