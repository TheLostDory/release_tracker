#!/usr/bin/env node
// Generates a JWT secret and the matching anon key for the Docker stack.
// Usage: node docker/generate-keys.mjs  → paste the output into .env
import { createHmac, randomBytes } from 'node:crypto'

const b64url = (input) => Buffer.from(input).toString('base64url')

function sign(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

const secret = process.argv[2] ?? randomBytes(32).toString('base64url')
if (secret.length < 32) throw new Error('JWT secret must be at least 32 characters')
const iat = Math.floor(Date.now() / 1000)
const exp = iat + 10 * 365 * 24 * 3600

console.log(`JWT_SECRET=${secret}`)
console.log(`ANON_KEY=${sign({ role: 'anon', iss: 'release-tracker-local', iat, exp }, secret)}`)
