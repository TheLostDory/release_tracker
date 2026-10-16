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
    throw new OutboundError(`${service} ${describeNetworkError(err, url)}`)
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

/** Turns low-level fetch failures into a reason an admin can act on. */
export function describeNetworkError(err: unknown, url: string): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  if (e.name === 'TimeoutError') return `did not answer within ${TIMEOUT_MS / 1000}s (${host(url)}). A firewall, VPN or proxy may be blocking it.`
  const code = e.cause?.code ?? ''
  const detail = code || e.cause?.message || e.message || 'unknown error'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `could not be found: ${host(url)} doesn't resolve from this server (${code}). Check the URL; if it's an internal address, this server may need the company VPN/DNS.`
  }
  if (code === 'ECONNREFUSED') return `refused the connection (${host(url)}, ${code}). Check the URL and port.`
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
    return `could not be reached (${host(url)}, ${code}). A firewall, VPN or proxy may be in the way.`
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) {
    return `uses an HTTPS certificate this server doesn't trust (${code}). This is common with company certificate authorities.`
  }
  return `could not be reached (${host(url)}: ${detail}).`
}

function host(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
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
