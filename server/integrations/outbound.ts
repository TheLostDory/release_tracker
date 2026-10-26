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
  /** Largest response accepted (default 5 MB). */
  maxBytes?: number
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
  /** The service's raw error response (first 2000 characters), for the server log. */
  readonly body: string | undefined
  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.status = status
    this.body = body
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
  let detail = ''
  let body: string | undefined
  if (!res.ok && req.errorDetail) {
    body = await res.text().then((t) => t.slice(0, 20_000)).catch(() => '')
    const described = body ? describeErrorBody(body) : ''
    detail = described ? ` Message: ${described}` : ''
    body = body.slice(0, 2000)
  }
  if (res.status === 401 || res.status === 403) {
    throw new OutboundError(`${service} rejected the credentials (HTTP ${res.status}).${detail}`, res.status, body)
  }
  if (res.status === 404) throw new OutboundError(`${service}: not found (HTTP 404). Check the URL, key or job path.${detail}`, 404, body)
  if (!res.ok && res.status !== 201) throw new OutboundError(`${service} returned HTTP ${res.status}.${detail}`, res.status, body)
  return res
}

/**
 * The useful part of an error response. Services nest it differently:
 * {error: {message, status}}, {error, error_description} (OAuth), Apigee's
 * {fault: {faultstring, detail: {errorcode}}}, Google's [{error: …}], or a
 * code plus a message side by side. Every informative field is kept, so a
 * generic code ("ErrorResponseCode") never hides the actual reason.
 */
export function describeErrorBody(text: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not JSON. For HTML error pages, the title (or the text without tags).
    const plain = /<html|<!doctype/i.test(text) ? (/<title>([^<]*)<\/title>/i.exec(text)?.[1] ?? text.replace(/<[^>]*>/g, ' ')) : text
    return plain.replace(/\s+/g, ' ').trim().slice(0, 300)
  }
  const found: string[] = []
  const add = (v: unknown) => {
    if (typeof v === 'string' || typeof v === 'number') {
      const t = String(v).replace(/\s+/g, ' ').trim()
      if (t && !found.includes(t)) found.push(t)
    }
  }
  const visit = (o: unknown, depth: number) => {
    if (depth > 4 || o === null || typeof o !== 'object') return
    if (Array.isArray(o)) return o.slice(0, 3).forEach((x) => visit(x, depth + 1))
    const r = o as Record<string, unknown>
    for (const key of ['error_description', 'message', 'faultstring', 'error', 'errorcode', 'errorCode', 'status', 'code', 'reason', 'detail', 'details', 'title']) {
      const v = r[key]
      if (v && typeof v === 'object') visit(v, depth + 1)
      else if (!(key === 'code' && typeof v === 'number' && v >= 100 && v < 600)) add(v) // the HTTP status is already in the message
    }
    if (r.fault) visit(r.fault, depth + 1)
  }
  visit(parsed, 0)
  return (found.length ? found.join(' · ') : text.replace(/\s+/g, ' ').trim()).slice(0, 400)
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
  const max = req.maxBytes ?? MAX_BYTES
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > max) throw new OutboundError(`${service} response is too large (${Math.round(length / 1048576)} MB).`)
  const text = await res.text()
  if (text.length > max) throw new OutboundError(`${service} response is too large (${Math.round(text.length / 1048576)} MB).`)
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
