import { createHash, X509Certificate } from 'node:crypto'
import { rootCertificates } from 'node:tls'
import { Agent, fetch as undiciFetch } from 'undici'
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
  /** Extra trusted CA certificates (PEM), e.g. a company root CA. */
  ca?: string | null
  timeoutMs?: number
  /** Include the service's own error message (first 300 chars) in failures. */
  errorDetail?: boolean
}

/**
 * One connection pool per distinct company CA: standard public roots PLUS
 * the given certificates (verification stays on; nothing is disabled).
 */
const agents = new Map<string, Agent>()
function agentFor(ca: string): Agent {
  const key = createHash('sha256').update(ca).digest('hex')
  let agent = agents.get(key)
  if (!agent) {
    agent = new Agent({ connect: { ca: [...rootCertificates, ...splitPem(ca)] } })
    agents.set(key, agent)
  }
  return agent
}

export function splitPem(pem: string): string[] {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
}

/** Validates pasted PEM text; returns normalized PEM or throws a 422 with the reason. */
export function normalizeCaCert(raw: string): string {
  const certs = splitPem(raw.trim())
  if (certs.length === 0) {
    throw new HttpError(422, 'Paste the certificate in PEM format (-----BEGIN CERTIFICATE----- …).', 'invalid')
  }
  for (const pem of certs) {
    try {
      new X509Certificate(pem)
    } catch {
      throw new HttpError(422, 'One of the pasted certificates could not be read.', 'invalid')
    }
  }
  return certs.join('\n') + '\n'
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
    res = (await undiciFetch(url, {
      method: req.method ?? 'GET',
      headers: { accept: 'application/json', ...req.headers },
      body: req.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(req.timeoutMs ?? TIMEOUT_MS),
      ...(req.ca ? { dispatcher: agentFor(req.ca) } : {}),
    })) as unknown as Response
  } catch (err) {
    throw new OutboundError(`${service} ${describeNetworkError(err, url, req.timeoutMs)}`)
  }
  if (res.status >= 300 && res.status < 400) {
    throw new OutboundError(`${service} redirected to ${res.headers.get('location') ?? 'another address'}. Use the final URL.`, res.status)
  }
  const detail = !res.ok && req.errorDetail ? await errorMessage(res) : ''
  if (res.status === 401 || res.status === 403) {
    throw new OutboundError(`${service} rejected the credentials (HTTP ${res.status}).${detail}`, res.status)
  }
  if (res.status === 404) throw new OutboundError(`${service}: not found (HTTP 404). Check the URL, key or job path.${detail}`, 404)
  if (!res.ok && res.status !== 201) throw new OutboundError(`${service} returned HTTP ${res.status}.${detail}`, res.status)
  return res
}

/** " Message: …" from a JSON error body ({error:{message}}, {message}…), or "". */
async function errorMessage(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, 20_000)
    let msg = text
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string; message?: string; detail?: string }
      // OAuth servers: {error: "invalid_client", error_description: "…"}.
      msg = j.error_description ?? (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? j.detail ?? text
    } catch {
      // Not JSON. For HTML error pages, the title (or the text without tags).
      if (/<html|<!doctype/i.test(text)) msg = /<title>([^<]*)<\/title>/i.exec(text)?.[1] ?? text.replace(/<[^>]*>/g, ' ')
    }
    msg = String(msg).replace(/\s+/g, ' ').trim().slice(0, 300)
    return msg ? ` Message: ${msg}` : ''
  } catch {
    return ''
  }
}

/** Turns low-level fetch failures into a reason an admin can act on. */
export function describeNetworkError(err: unknown, url: string, timeoutMs = TIMEOUT_MS): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  if (e.name === 'TimeoutError') return `did not answer within ${timeoutMs / 1000}s (${host(url)}). A firewall, VPN or proxy may be blocking it.`
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
    return `uses an HTTPS certificate this server doesn't trust (${code}). If your company uses its own certificate authority, paste its certificate under "Company HTTPS certificate" in the connection settings.`
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

/** The response body as text (size-capped), with its content type. */
export async function outboundText(url: string, service: string, req: OutboundRequest = {}): Promise<{ text: string; contentType: string }> {
  const res = await outbound(url, service, req)
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES) throw new OutboundError(`${service} response is too large.`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new OutboundError(`${service} response is too large.`)
  return { text, contentType: res.headers.get('content-type') ?? '' }
}

export async function outboundJson<T>(url: string, service: string, req: OutboundRequest = {}): Promise<T> {
  const { text } = await outboundText(url, service, req)
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
