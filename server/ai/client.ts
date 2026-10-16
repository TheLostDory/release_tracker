import type { Config } from '../config.js'
import { HttpError } from '../http/errors.js'
import { normalizeCaCert, OutboundError, outboundJson, outboundText } from '../integrations/outbound.js'

/**
 * Client for the company AI gateway. Formats: Vertex AI (Gemini) and the
 * Gemini API (both "generateContent"), or OpenAI-compatible chat completions.
 * Credentials are a static key/secret in headers, or an OAuth client-credentials
 * token (e.g. Apigee in front of Vertex AI). Nothing secret leaves the server.
 */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

const SERVICE = 'The AI service'
export const TOKEN_SERVICE = 'The AI login (AI_TOKEN_URL)'
const TIMEOUT_MS = 90_000

const DEFAULTS = {
  // Same request as the AI Relay IDE extension's Apigee mode (streamed, read whole).
  vertex: {
    path: '/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent?alt=sse',
    headers: { authorization: 'Bearer {token}' },
  },
  gemini: { path: '/v1beta/models/{model}:generateContent', headers: { 'x-goog-api-key': '{key}' } },
  openai: { path: '/v1/chat/completions', headers: { authorization: 'Bearer {key}' } },
} as const

export const aiEnabled = (config: Config) => !!config.AI_BASE_URL

const notConfigured = (message: string) => new HttpError(503, message, 'not_configured')

/** Resolved request settings; throws a 503 when the server isn't configured. */
export function aiSettings(config: Config) {
  if (!config.AI_BASE_URL) throw notConfigured('The assistant is not set up on this server (AI_BASE_URL).')
  const format = config.AI_FORMAT
  if (format === 'vertex' && !config.AI_PROJECT_ID) throw notConfigured('Vertex AI needs AI_PROJECT_ID (the Google Cloud project id).')
  if (config.AI_TOKEN_URL && (!config.AI_CLIENT_ID || !config.AI_CLIENT_SECRET)) {
    throw notConfigured('AI_TOKEN_URL needs AI_CLIENT_ID and AI_CLIENT_SECRET.')
  }
  const fillUrl = (s: string) =>
    s
      .replaceAll('{model}', encodeURIComponent(config.AI_MODEL))
      .replaceAll('{project}', encodeURIComponent(config.AI_PROJECT_ID ?? ''))
      .replaceAll('{location}', encodeURIComponent(config.AI_LOCATION))

  let template: Record<string, string> = { ...DEFAULTS[format].headers }
  if (config.AI_HEADERS) {
    try {
      const parsed = JSON.parse(config.AI_HEADERS) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      template = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
    } catch {
      throw notConfigured('AI_HEADERS must be a JSON object, e.g. {"X-App-Key":"{key}"}.')
    }
  }
  if (Object.values(template).some((v) => v.includes('{token}')) && !config.AI_TOKEN_URL) {
    throw notConfigured('The request uses a login token: set AI_TOKEN_URL, AI_CLIENT_ID and AI_CLIENT_SECRET.')
  }
  /** Headers for a request, with the current token filled in. */
  const headers = (token = '') =>
    Object.fromEntries(
      Object.entries(template).map(([k, v]) => [
        k,
        v
          .replaceAll('{key}', config.AI_API_KEY ?? '')
          .replaceAll('{secret}', config.AI_API_SECRET ?? '')
          .replaceAll('{token}', token)
          .replaceAll('{model}', config.AI_MODEL)
          .replaceAll('{project}', config.AI_PROJECT_ID ?? '')
          .replaceAll('{location}', config.AI_LOCATION),
      ]),
    )
  // A base URL that is already the full endpoint (some gateways expose exactly
  // one, or AI_PATH=/) is used as is; otherwise the format's path is appended.
  const base = fillUrl(decodeURI(config.AI_BASE_URL).replace(/\/+$/, ''))
  const complete = config.AI_PATH === '/' || (!config.AI_PATH && /(:generateContent|:streamGenerateContent(\?alt=sse)?|\/chat\/completions)$/.test(base))
  const path = config.AI_PATH ?? DEFAULTS[format].path
  const url = complete ? base : base + fillUrl(path.startsWith('/') ? path : `/${path}`)
  const ca = config.AI_CA_CERT ? normalizeCaCert(config.AI_CA_CERT.replaceAll('\\n', '\n')) : null
  return { format, url, headers, headerNames: Object.keys(template), ca, model: config.AI_MODEL, usesToken: !!config.AI_TOKEN_URL }
}

// --- OAuth client-credentials token (cached until shortly before it expires) ----------
const tokens = new Map<string, { token: string; expiresAt: number }>()

export async function aiToken(config: Config, ca: string | null, { fresh = false } = {}): Promise<string> {
  const key = [config.AI_TOKEN_URL, config.AI_CLIENT_ID, config.AI_TOKEN_SCOPE, config.AI_TOKEN_AUTH].join('|')
  const hit = tokens.get(key)
  if (!fresh && hit && hit.expiresAt > Date.now()) return hit.token

  const form = new URLSearchParams({ grant_type: 'client_credentials' })
  if (config.AI_TOKEN_SCOPE) form.set('scope', config.AI_TOKEN_SCOPE)
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (config.AI_TOKEN_AUTH === 'basic') {
    headers.authorization = `Basic ${Buffer.from(`${config.AI_CLIENT_ID}:${config.AI_CLIENT_SECRET}`).toString('base64')}`
  } else {
    form.set('client_id', config.AI_CLIENT_ID!)
    form.set('client_secret', config.AI_CLIENT_SECRET!)
  }
  const res = await outboundJson<{ access_token?: string; expires_in?: number | string }>(config.AI_TOKEN_URL!, TOKEN_SERVICE, {
    method: 'POST',
    headers,
    body: form.toString(),
    ca,
    errorDetail: true,
  })
  if (!res.access_token) throw new OutboundError(`${TOKEN_SERVICE} answered without an access_token.`)
  // Refresh a minute early; assume one hour when the lifetime isn't given.
  const seconds = Number(res.expires_in) > 0 ? Number(res.expires_in) : 3600
  tokens.set(key, { token: res.access_token, expiresAt: Date.now() + Math.max(seconds - 60, 30) * 1000 })
  return res.access_token
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}
interface OpenAiResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
}

type ModelResponse = GeminiResponse & OpenAiResponse

/** A JSON response, or a server-sent-events stream (streamGenerateContent?alt=sse) as its chunks. */
export function parseResponse({ text, contentType }: { text: string; contentType: string }): ModelResponse | ModelResponse[] {
  if (contentType.includes('text/event-stream') || /^\s*data:/.test(text)) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((data) => data && data !== '[DONE]')
      .flatMap((data) => {
        try {
          return [JSON.parse(data) as ModelResponse]
        } catch {
          return []
        }
      })
  }
  try {
    const parsed = JSON.parse(text) as ModelResponse | ModelResponse[]
    return parsed
  } catch {
    throw new OutboundError(`${SERVICE} didn't return JSON. Check AI_FORMAT and AI_PATH.`)
  }
}

/** Sends one conversation; returns the model's text answer. */
export async function askModel(config: Config, system: string, turns: ChatTurn[]): Promise<string> {
  const s = aiSettings(config)
  const geminiLike = s.format !== 'openai'
  const body = geminiLike
    ? {
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
        // Apigee gateways may validate the body and reject unknown fields: Vertex gets only the basics.
        ...(s.format === 'gemini' ? { generationConfig: { temperature: 0.2, maxOutputTokens: 4096 } } : {}),
      }
    : {
        model: s.model,
        messages: [{ role: 'system', content: system }, ...turns],
        temperature: 0.2,
        max_tokens: 2048,
      }

  const send = async (fresh: boolean) =>
    parseResponse(
      await outboundText(s.url, SERVICE, {
        method: 'POST',
        headers: { ...s.headers(s.usesToken ? await aiToken(config, s.ca, { fresh }) : ''), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ca: s.ca,
        timeoutMs: TIMEOUT_MS,
        errorDetail: true,
      }),
    )

  let text: string | undefined
  try {
    let res: ModelResponse | ModelResponse[]
    try {
      res = await send(false)
    } catch (err) {
      // A cached token may have been revoked or expired early: get a new one, once.
      if (!(s.usesToken && err instanceof OutboundError && err.status === 401 && err.message.startsWith(SERVICE))) throw err
      res = await send(true)
    }
    if (geminiLike) {
      // One response, or the chunks of a streamed one, each with part of the text.
      const chunks = Array.isArray(res) ? res : [res]
      const blocked = chunks.find((c) => c.promptFeedback?.blockReason)?.promptFeedback?.blockReason
      if (blocked) throw new OutboundError(`${SERVICE} declined the question (${blocked}).`)
      text = chunks
        .flatMap((c) => c.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('')
    } else {
      text = (Array.isArray(res) ? res[0] : res)?.choices?.[0]?.message?.content ?? undefined
    }
  } catch (err) {
    if (err instanceof OutboundError) {
      // The integrations' certificate hint points at project settings; the gateway is configured on the server.
      const message = err.message
        .replace(/ If your company uses .*$/, ' Set AI_CA_CERT on the server to your company root certificate.')
        .replace(
          'Check the URL, key or job path.',
          err.message.startsWith(TOKEN_SERVICE) ? 'Check AI_TOKEN_URL.' : 'Check AI_BASE_URL, AI_PATH, AI_PROJECT_ID, AI_LOCATION and AI_MODEL.',
        )
      console.warn(`[ai] ${message}`)
      throw new HttpError(502, message, 'ai_error')
    }
    throw err
  }
  if (!text?.trim()) throw new HttpError(502, `${SERVICE} returned an empty answer. Check AI_FORMAT and AI_PATH.`, 'ai_error')
  return text.trim()
}
