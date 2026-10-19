import { describe, expect, it } from 'vitest'
import { describeNetworkError, describeErrorBody } from './outbound.js'

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

describe('describeErrorBody', () => {
  it('keeps every informative field, so a generic code never hides the reason', () => {
    expect(describeErrorBody(JSON.stringify({ error: 'ErrorResponseCode', message: 'Quota exceeded for gemini-2.5-flash' }))).toBe(
      'Quota exceeded for gemini-2.5-flash · ErrorResponseCode',
    )
    // Apigee faults.
    expect(describeErrorBody(JSON.stringify({ fault: { faultstring: 'Execution of ServiceCallout failed', detail: { errorcode: 'steps.servicecallout.ExecutionFailed' } } }))).toBe(
      'Execution of ServiceCallout failed · steps.servicecallout.ExecutionFailed',
    )
    // Google APIs (also as a one-element array from streaming endpoints).
    expect(describeErrorBody(JSON.stringify([{ error: { code: 500, message: 'Internal error encountered.', status: 'INTERNAL' } }]))).toBe(
      'Internal error encountered. · INTERNAL',
    )
    // OAuth.
    expect(describeErrorBody(JSON.stringify({ error: 'invalid_client', error_description: 'Client credentials are invalid' }))).toBe(
      'Client credentials are invalid · invalid_client',
    )
  })

  it('handles HTML pages and plain text', () => {
    expect(describeErrorBody('<html><head><title>502 Bad Gateway</title></head><body>…</body></html>')).toBe('502 Bad Gateway')
    expect(describeErrorBody('upstream   timed out')).toBe('upstream timed out')
  })
})
