import type { Config } from '../config.js'
import { HttpError } from '../http/errors.js'
import { normalizeCaCert, OutboundError, outboundJson } from '../integrations/outbound.js'

/**
 * Client for the company AI gateway ("airelay"). Two request formats are
 * supported because gateways differ: Gemini's generateContent and the
 * OpenAI-compatible chat completions. URL path and headers are configurable;
 * the key and secret never leave the server.
 */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

const SERVICE = 'The AI service'
const TIMEOUT_MS = 90_000

const DEFAULTS = {
  gemini: { path: '/v1beta/models/{model}:generateContent', headers: { 'x-goog-api-key': '{key}' } },
  openai: { path: '/v1/chat/completions', headers: { authorization: 'Bearer {key}' } },
} as const

export const aiEnabled = (config: Config) => !!config.AI_BASE_URL

/** Resolved request settings; throws a 503 when the server isn't configured. */
export function aiSettings(config: Config) {
  if (!config.AI_BASE_URL) throw new HttpError(503, 'The assistant is not set up on this server (AI_BASE_URL).', 'not_configured')
  const format = config.AI_FORMAT
  const fill = (s: string) =>
    s
      .replaceAll('{model}', encodeURIComponent(config.AI_MODEL))
      .replaceAll('{key}', config.AI_API_KEY ?? '')
      .replaceAll('{secret}', config.AI_API_SECRET ?? '')

  let template: Record<string, string> = { ...DEFAULTS[format].headers }
  if (config.AI_HEADERS) {
    try {
      const parsed = JSON.parse(config.AI_HEADERS) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      template = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
    } catch {
      throw new HttpError(503, 'AI_HEADERS must be a JSON object, e.g. {"X-App-Key":"{key}"}.', 'not_configured')
    }
  }
  const headers = Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fill(v)]))
  const path = config.AI_PATH ?? DEFAULTS[format].path
  const url = config.AI_BASE_URL.replace(/\/+$/, '') + fill(path.startsWith('/') ? path : `/${path}`)
  const ca = config.AI_CA_CERT ? normalizeCaCert(config.AI_CA_CERT.replaceAll('\\n', '\n')) : null
  return { format, url, headers, ca, model: config.AI_MODEL }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}
interface OpenAiResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
}

/** Sends one conversation; returns the model's text answer. */
export async function askModel(config: Config, system: string, turns: ChatTurn[]): Promise<string> {
  const s = aiSettings(config)
  const body =
    s.format === 'gemini'
      ? {
          systemInstruction: { parts: [{ text: system }] },
          contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }
      : {
          model: s.model,
          messages: [{ role: 'system', content: system }, ...turns],
          temperature: 0.2,
          max_tokens: 2048,
        }

  let text: string | undefined
  try {
    const res = await outboundJson<GeminiResponse & OpenAiResponse>(s.url, SERVICE, {
      method: 'POST',
      headers: { ...s.headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ca: s.ca,
      timeoutMs: TIMEOUT_MS,
      errorDetail: true,
    })
    if (s.format === 'gemini') {
      if (res.promptFeedback?.blockReason) throw new OutboundError(`${SERVICE} declined the question (${res.promptFeedback.blockReason}).`)
      text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
    } else {
      text = res.choices?.[0]?.message?.content ?? undefined
    }
  } catch (err) {
    if (err instanceof OutboundError) {
      // The integrations' certificate hint points at project settings; the gateway is configured on the server.
      const message = err.message
        .replace(/ If your company uses .*$/, ' Set AI_CA_CERT on the server to your company root certificate.')
        .replace('Check the URL, key or job path.', 'Check AI_BASE_URL, AI_PATH and AI_MODEL.')
      console.warn(`[ai] ${message}`)
      throw new HttpError(502, message, 'ai_error')
    }
    throw err
  }
  if (!text?.trim()) throw new HttpError(502, `${SERVICE} returned an empty answer. Check AI_FORMAT and AI_PATH.`, 'ai_error')
  return text.trim()
}
