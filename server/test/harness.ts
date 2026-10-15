import type { AddressInfo } from 'node:net'
import { inject } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createPool } from '../db/pool.js'
import { ReleaseEvents } from '../realtime.js'

/** True when testing a running deployment (API_BASE_URL) instead of a local server. */
export const remote = !!process.env.API_BASE_URL

/** Starts the real app on a random port against the test database. */
export async function startServer() {
  if (process.env.API_BASE_URL) return { base: process.env.API_BASE_URL.replace(/\/$/, ''), stop: async () => {} }
  const url = inject('appDatabaseUrl')
  const config = loadConfig({ DATABASE_URL: url, NODE_ENV: 'test', ENCRYPTION_KEY: 'test-encryption-key-0123456789-abcdefghij' })
  const db = createPool(url)
  const events = new ReleaseEvents(url)
  await events.start()
  const app = createApp({ db, config, events })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    base,
    async stop() {
      await events.stop()
      await new Promise((r) => server.close(r))
      await db.end()
    },
  }
}

export interface ApiResponse<T = any> {
  status: number
  body: T
}

/** A browser-like client: keeps the session cookie, sends the CSRF header. */
export function client(base: string) {
  let cookie = ''
  async function request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
    const res = await fetch(base + path, {
      method,
      headers: {
        'x-requested-with': 'release-tracker',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]!.endsWith('=') ? '' : setCookie.split(';')[0]!
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  return {
    get cookie() {
      return cookie
    },
    get: <T = any>(p: string) => request<T>('GET', p),
    post: <T = any>(p: string, b?: unknown, h?: Record<string, string>) => request<T>('POST', p, b ?? {}, h),
    patch: <T = any>(p: string, b: unknown) => request<T>('PATCH', p, b),
    put: <T = any>(p: string, b: unknown) => request<T>('PUT', p, b),
    del: <T = any>(p: string) => request<T>('DELETE', p),
    raw: request,
    async login(email: string, password = 'password123') {
      const r = await request('POST', '/api/auth/login', { email, password })
      if (r.status !== 200) throw new Error(`login ${email} failed: ${JSON.stringify(r.body)}`)
      return r.body.user as { id: string; name: string; email: string }
    },
  }
}
