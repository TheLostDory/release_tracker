import type { Response, Router } from 'express'
import { Router as createRouter } from 'express'
import pg from 'pg'
import type { Db } from './db/pool.js'
import { notFound } from './http/errors.js'
import { asUser, idParam } from './http/helpers.js'

/**
 * Live updates: database triggers `pg_notify('release_changes', {release_id})`;
 * one LISTEN connection fans them out to Server-Sent Event streams. Events
 * carry only "release X changed": clients refetch through the normal,
 * permission-checked API.
 */
export class ReleaseEvents {
  private subscribers = new Map<string, Set<Response>>()
  private client: pg.Client | null = null
  private stopped = false

  constructor(private readonly connectionString: string) {}

  async start() {
    this.stopped = false
    const client = new pg.Client({ connectionString: this.connectionString })
    client.on('notification', (msg) => {
      if (!msg.payload) return
      try {
        const { release_id } = JSON.parse(msg.payload) as { release_id?: string }
        if (release_id) this.publish(release_id)
      } catch {
        // Ignore malformed payloads.
      }
    })
    client.on('error', (err) => {
      console.error('[events] listener error, reconnecting:', err.message)
      this.reconnect()
    })
    client.on('end', () => this.reconnect())
    await client.connect()
    await client.query('listen release_changes')
    this.client = client
  }

  private reconnect() {
    if (this.stopped || !this.client) return
    const old = this.client
    this.client = null
    old.removeAllListeners()
    setTimeout(() => this.start().catch((e: Error) => console.error('[events] reconnect failed:', e.message)), 2000)
  }

  async stop() {
    this.stopped = true
    for (const set of this.subscribers.values()) for (const res of set) res.end()
    this.subscribers.clear()
    await this.client?.end().catch(() => {})
  }

  private publish(releaseId: string) {
    for (const res of this.subscribers.get(releaseId) ?? []) res.write(`event: change\ndata: {}\n\n`)
  }

  subscribe(releaseId: string, res: Response) {
    let set = this.subscribers.get(releaseId)
    if (!set) this.subscribers.set(releaseId, (set = new Set()))
    set.add(res)
    return () => {
      set.delete(res)
      if (set.size === 0) this.subscribers.delete(releaseId)
    }
  }

  routes(db: Db): Router {
    const router = createRouter()
    router.get('/releases/:id/events', async (req, res) => {
      const id = idParam(req)
      // Only stream releases the user can see.
      const visible = await asUser(db, req, async (tx) => (await tx.query('select 1 from releases where id = $1', [id])).rowCount)
      if (!visible) throw notFound('Release not found.')
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write(': connected\n\n')
      const unsubscribe = this.subscribe(id, res)
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000)
      req.on('close', () => {
        clearInterval(heartbeat)
        unsubscribe()
      })
    })
    return router
  }
}
