import { describe, expect, it } from 'vitest'
import { parseParameters } from './parameters'

describe('parseParameters', () => {
  it('parses KEY=value lines, ignoring blanks', () => {
    expect(parseParameters('RC_VERSION={{version}}\n\nENV = staging\nURL=a=b')).toEqual({
      params: { RC_VERSION: '{{version}}', ENV: 'staging', URL: 'a=b' },
      error: null,
    })
  })
  it('reports bad lines', () => {
    expect(parseParameters('OK=1\nnot a pair').error).toBe('Line 2: use KEY=value')
    expect(parseParameters('bad key=1').error).toBe('Line 1: use KEY=value')
  })
})
