import { connect, type DetailedPeerCertificate } from 'node:tls'
import { HttpError } from '../http/errors.js'

export interface PresentedCertificate {
  subject: string
  issuer: string
  validTo: string
  fingerprint256: string
  selfSigned: boolean
  pem: string
}

const toPem = (der: Buffer) =>
  `-----BEGIN CERTIFICATE-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END CERTIFICATE-----\n`

const name = (n: Record<string, string | string[]> | undefined) => {
  const cn = n?.CN ?? n?.O
  return (Array.isArray(cn) ? cn.join(', ') : cn) ?? 'unknown'
}

/**
 * Reads the certificate chain a server presents, WITHOUT trusting it: used
 * so an admin can review and explicitly trust a company root CA. Nothing is
 * sent besides the TLS handshake; the connection is closed immediately.
 */
export async function inspectCertificates(baseUrl: string): Promise<{ host: string; certificates: PresentedCertificate[]; recommended: number }> {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:') throw new HttpError(422, 'Only https:// addresses use certificates.', 'invalid')
  const host = url.hostname
  const port = Number(url.port || 443)

  const peer = await new Promise<DetailedPeerCertificate>((resolve, reject) => {
    const socket = connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate(true)
      socket.end()
      resolve(cert)
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new HttpError(502, `${host} did not answer within 10s.`, 'integration_error'))
    })
    socket.on('error', (err: NodeJS.ErrnoException) =>
      reject(new HttpError(502, `Could not connect to ${host}:${port} (${err.code ?? err.message}).`, 'integration_error')),
    )
  })
  if (!peer?.raw) throw new HttpError(502, `${host} didn't present a certificate.`, 'integration_error')

  // Walk leaf → root (Node links issuerCertificate; the root links to itself).
  const certificates: PresentedCertificate[] = []
  const seen = new Set<string>()
  for (let c: DetailedPeerCertificate | undefined = peer; c?.raw && !seen.has(c.fingerprint256); c = c.issuerCertificate) {
    seen.add(c.fingerprint256)
    certificates.push({
      subject: name(c.subject as unknown as Record<string, string>),
      issuer: name(c.issuer as unknown as Record<string, string>),
      validTo: new Date(c.valid_to).toISOString(),
      fingerprint256: c.fingerprint256,
      selfSigned: c.fingerprint256 === c.issuerCertificate?.fingerprint256,
      pem: toPem(c.raw),
    })
  }
  // Trust anchors are roots: recommend the self-signed one (else the top of the chain).
  const root = certificates.findIndex((c) => c.selfSigned)
  return { host, certificates, recommended: root === -1 ? certificates.length - 1 : root }
}
