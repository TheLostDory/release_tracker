import type { RequestHandler } from 'express'
import helmet from 'helmet'
import { HttpError } from './errors.js'

/** Security headers, including the CSP (scripts and connections: own origin only). */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Radix positions popovers with inline style attributes.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Only meaningful over HTTPS; browsers ignore it on plain http.
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true },
})

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for cookie-authenticated API calls: state-changing requests
 * must carry our custom header (cross-site forms can't set it, and CORS is
 * never enabled) and, when the browser sends Origin, it must match this host.
 * Session cookies are also SameSite=Lax.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next()
  if (req.get('x-requested-with') !== 'release-tracker') {
    return next(new HttpError(403, 'Missing request header.', 'csrf'))
  }
  const origin = req.get('origin')
  if (origin) {
    let host: string
    try {
      host = new URL(origin).host
    } catch {
      return next(new HttpError(403, 'Bad origin.', 'csrf'))
    }
    if (host !== req.get('host')) return next(new HttpError(403, 'Cross-origin request refused.', 'csrf'))
  }
  next()
}
