import { describe, expect, it } from 'vitest'
import { parseParamList } from './jobs'

describe('parseParamList', () => {
  it('reads KEY=value pairs separated by commas or lines, dropping bad ones', () => {
    expect(parseParamList('RC_VERSION={{version}}, ENV=staging\nNOTE=a=b, bad pair, =x')).toEqual({ RC_VERSION: '{{version}}', ENV: 'staging', NOTE: 'a=b' })
  })
})
