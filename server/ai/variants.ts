import type { Config } from '../config.js'
import { OutboundError, outboundText } from '../integrations/outbound.js'
import { aiSettings, aiToken, parseResponse, requestBody, requestHeaders } from './client.js'

/**
 * When the gateway answers 5xx to a request the AI Relay IDE extension gets
 * through, try the remaining differences one at a time: which one does the
 * gateway care about? One tiny request each, to the configured gateway only.
 */
export interface VariantResult {
  name: string
  fix: string
  ok: boolean
  message: string
}

const JAVA_UA = 'Java/21.0.4'

export async function tryVariants(config: Config): Promise<VariantResult[]> {
  const s = aiSettings(config)
  const token = s.usesToken ? await aiToken(config, s.ca) : ''
  const turns = [{ role: 'user' as const, content: 'Reply with the single word OK.' }]
  const system = 'You are a connectivity check.'
  const nonStreaming = s.url.replace(/:streamGenerateContent(\?alt=sse)?$/, ':generateContent')

  const variants: { name: string; fix: string; url?: string; ua?: string; system?: string | null }[] = [
    { name: `User-Agent "${JAVA_UA}" (like the AI Relay extension)`, fix: `AI_USER_AGENT=${JAVA_UA}`, ua: JAVA_UA },
    { name: 'without the system instruction', fix: '(tell Claude: the gateway rejects system instructions)', system: null },
    { name: 'both of the above', fix: `AI_USER_AGENT=${JAVA_UA}  (and tell Claude: no system instruction)`, ua: JAVA_UA, system: null },
    ...(nonStreaming !== s.url
      ? [{ name: 'non-streaming generateContent', fix: `AI_PATH=${new URL(nonStreaming).pathname.replace(config.AI_MODEL, '{model}')}`, url: nonStreaming }]
      : []),
  ]

  const results: VariantResult[] = []
  for (const v of variants) {
    try {
      const { text, contentType } = await outboundText(v.url ?? s.url, 'The AI service', {
        method: 'POST',
        headers: { ...requestHeaders({ AI_USER_AGENT: v.ua ?? config.AI_USER_AGENT }), ...s.headers(token) },
        body: JSON.stringify(requestBody(s.format, s.model, v.system === undefined ? system : v.system, turns)),
        ca: s.ca,
        timeoutMs: 60_000,
        errorDetail: true,
      })
      parseResponse({ text, contentType })
      results.push({ name: v.name, fix: v.fix, ok: true, message: 'answered' })
    } catch (err) {
      results.push({ name: v.name, fix: v.fix, ok: false, message: err instanceof OutboundError ? err.message : (err as Error).message })
    }
  }
  return results
}
