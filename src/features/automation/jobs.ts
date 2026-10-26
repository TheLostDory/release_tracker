import type { JobPurpose } from './api'

export const PURPOSE_LABEL: Record<JobPurpose, string> = { LOAD_TEST: 'Load Test', LONGEVITY: 'Longevity', HIT: 'HIT', AUTOMATED: 'Job' }

/** "RC_VERSION={{version}}, ENV=staging" → { RC_VERSION: '{{version}}', ENV: 'staging' } (bad pairs are dropped). */
export function parseParamList(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of text.split(/[,\n]/)) {
    const eq = part.indexOf('=')
    const key = part.slice(0, eq).trim()
    if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key)) out[key] = part.slice(eq + 1).trim()
  }
  return out
}

