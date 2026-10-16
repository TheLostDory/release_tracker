import type { Config } from '../config.js'
import { OutboundError, outbound } from '../integrations/outbound.js'
import { aiSettings, aiToken } from './client.js'

/**
 * Tries the usual ways gateways expose Gemini/Vertex (and OpenAI-style) under
 * AI_BASE_URL, with one tiny request each, to find the path a company proxy
 * uses. Only talks to the configured gateway, with the configured login.
 */
const CANDIDATES: { path: string; format: 'gemini' | 'openai' }[] = [
  // What the AI Relay IDE extension calls in Apigee mode.
  { path: '/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent?alt=sse', format: 'gemini' },
  { path: '/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent', format: 'gemini' },
  { path: '/v1beta1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent', format: 'gemini' },
  { path: '/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent', format: 'gemini' },
  { path: '/publishers/google/models/{model}:generateContent', format: 'gemini' },
  { path: '/v1/models/{model}:generateContent', format: 'gemini' },
  { path: '/v1beta/models/{model}:generateContent', format: 'gemini' },
  { path: '/models/{model}:generateContent', format: 'gemini' },
  { path: '/{model}:generateContent', format: 'gemini' },
  { path: '/generateContent', format: 'gemini' },
  { path: '', format: 'gemini' },
  { path: '/v1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions', format: 'openai' },
  { path: '/v1/chat/completions', format: 'openai' },
  { path: '/chat/completions', format: 'openai' },
]

export interface ProbeResult {
  path: string
  format: 'gemini' | 'openai'
  status: number | 'error'
  message: string
}

export async function probeGateway(config: Config): Promise<ProbeResult[]> {
  const s = aiSettings(config)
  const token = s.usesToken ? await aiToken(config, s.ca) : ''
  const base = decodeURI(config.AI_BASE_URL!).replace(/\/+$/, '')
  const fill = (p: string) =>
    p
      .replaceAll('{model}', encodeURIComponent(config.AI_MODEL))
      .replaceAll('{project}', encodeURIComponent(config.AI_PROJECT_ID ?? ''))
      .replaceAll('{location}', encodeURIComponent(config.AI_LOCATION))
  const question = 'Reply with the single word OK.'
  const bodies = {
    gemini: { contents: [{ role: 'user', parts: [{ text: question }] }] },
    openai: { model: config.AI_MODEL, messages: [{ role: 'user', content: question }], max_tokens: 20 },
  }

  const results: ProbeResult[] = []
  for (const c of CANDIDATES) {
    try {
      const res = await outbound(fill(base + c.path), 'Gateway', {
        method: 'POST',
        headers: { ...s.headers(token), 'content-type': 'application/json' },
        body: JSON.stringify(bodies[c.format]),
        ca: s.ca,
        timeoutMs: 30_000,
        errorDetail: true,
      })
      results.push({ path: c.path, format: c.format, status: res.status, message: (await res.text()).replace(/\s+/g, ' ').slice(0, 120) })
    } catch (err) {
      const e = err as OutboundError
      results.push({ path: c.path, format: c.format, status: e.status ?? 'error', message: e.message.replace(/^Gateway:? ?/, '').slice(0, 160) })
    }
  }
  return results
}
