import { HttpError } from '../http/errors.js'

/**
 * Calls to Jira/Jenkins: timeouts, a response size cap, no redirects
 * (credentials must not be replayed to another host), and errors worded for
 * admins without leaking response bodies.
 */
const TIMEOUT_MS = 15_000
const MAX_BYTES = 5 * 1024 * 1024

export interface OutboundRequest {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

export class OutboundError extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export async function outbound(url: string, service: string, req: OutboundRequest = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      method: req.method ?? 'GET',
      headers: { accept: 'application/json', ...req.headers },
      body: req.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const reason = (err as Error).name === 'TimeoutError' ? 'timed out' : 'could not be reached'
    throw new OutboundError(`${service} ${reason}. Check the URL and that this server can reach it.`)
  }
  if (res.status >= 300 && res.status < 400) {
    throw new OutboundError(`${service} redirected to ${res.headers.get('location') ?? 'another address'}. Use the final URL.`, res.status)
  }
  if (res.status === 401 || res.status === 403) {
    throw new OutboundError(`${service} rejected the credentials (HTTP ${res.status}).`, res.status)
  }
  if (res.status === 404) throw new OutboundError(`${service}: not found (HTTP 404). Check the URL, key or job path.`, 404)
  if (!res.ok && res.status !== 201) throw new OutboundError(`${service} returned HTTP ${res.status}.`, res.status)
  return res
}

export async function outboundJson<T>(url: string, service: string, req: OutboundRequest = {}): Promise<T> {
  const res = await outbound(url, service, req)
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES) throw new OutboundError(`${service} response is too large.`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new OutboundError(`${service} response is too large.`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new OutboundError(`${service} didn't return JSON. Is the URL the ${service} base address?`)
  }
}

/** Converts an outbound failure into an API error for the requester. */
export function asHttpError(err: unknown): never {
  if (err instanceof OutboundError) throw new HttpError(502, err.message, 'integration_error')
  throw err
}

/** "https://jira.example.com/" → "https://jira.example.com" (no credentials, http(s) only). */
export function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new HttpError(422, 'Enter a full URL, e.g. https://jira.example.com', 'invalid')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(422, 'Use an http(s) URL.', 'invalid')
  if (url.username || url.password) throw new HttpError(422, "Don't put credentials in the URL.", 'invalid')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}
