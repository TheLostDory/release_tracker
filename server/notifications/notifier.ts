import { buildActionItems, type ActionRelease } from '../../src/lib/action-items.js'
import type { Config } from '../config.js'
import { decrypt } from '../crypto.js'
import type { Db } from '../db/pool.js'
import { OutboundError } from '../integrations/outbound.js'
import { DEFAULT_TEAMS_SETTINGS, postTeamsCard, type TeamsSettings } from '../integrations/teams.js'
import { dailyCard, releaseCard, type OutboxEvent, type ReleaseEvent } from './cards.js'

type DueRow = OutboxEvent & {
  id: string
  project_id: string
  release_id: string | null
  attempts: number
  integration_id: string
  secret_encrypted: string
  ca_cert: string | null
}

/**
 * Posts queued events to each project's Teams channel: one card per release
 * per batch (a Jenkins failure and the step it blocks arrive together), and
 * daily summaries. Failures are retried with back-off by the database.
 */
export async function deliverNotifications(db: Db, config: Config, minAgeSeconds = 5): Promise<{ sent: number; failed: number }> {
  if (!config.ENCRYPTION_KEY) return { sent: 0, failed: 0 }
  const { rows } = await db.query<DueRow>('select * from notifications_due(make_interval(secs => $1))', [minAgeSeconds])
  const groups = new Map<string, DueRow[]>()
  for (const r of rows) {
    const key = r.kind === 'daily' ? `daily:${r.id}` : `${r.project_id}:${r.release_id}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  let sent = 0
  let failed = 0
  for (const batch of groups.values()) {
    const first = batch[0]!
    const ids = batch.map((r) => r.id)
    try {
      const webhook = decrypt(first.secret_encrypted, config.ENCRYPTION_KEY)
      const events = batch.filter((r): r is DueRow & ReleaseEvent => r.kind !== 'daily')
      const card = first.kind === 'daily' ? first.payload.card : releaseCard(config.APP_URL, events[0]!.payload.release, events)
      await postTeamsCard(webhook, card, first.ca_cert)
      await db.query('select notifications_mark($1, null)', [ids])
      sent += batch.length
    } catch (err) {
      const message = err instanceof OutboundError ? err.message : `Could not send: ${(err as Error).message}`
      console.warn(`[teams] ${message}`)
      await db.query('select notifications_mark($1, $2)', [ids, message]).catch(() => {})
      failed += batch.length
    }
  }
  return { sent, failed }
}

/** Date and "HH:MM" now in a time zone (falls back to UTC for unknown zones). */
export function localNow(timezone: string, now = new Date()) {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(now)
  } catch {
    return localNow('UTC', now)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, weekday: get('weekday') }
}

/**
 * Queues today's summary for every project whose time has come (once per
 * day; if the server was off at that time, it goes out when it starts).
 */
export async function queueDailySummaries(db: Db, config: Config, now = new Date()): Promise<number> {
  const { rows } = await db.query<{ project_id: string; project_name: string; settings: Partial<TeamsSettings> }>(
    'select * from daily_summary_projects()',
  )
  let queued = 0
  for (const p of rows) {
    const s = { ...DEFAULT_TEAMS_SETTINGS, ...p.settings }
    const local = localNow(s.timezone, now)
    if (s.weekdaysOnly && (local.weekday === 'Sat' || local.weekday === 'Sun')) continue
    if (local.time < s.dailyTime) continue
    const releases = (await db.query<{ r: ActionRelease[] }>('select daily_summary_releases($1) as r', [p.project_id])).rows[0]!.r
    // The rules run as of noon on the project's local date (the dashboard's logic, same results).
    const [y, m, d] = local.day.split('-').map(Number)
    const today = new Date(y!, m! - 1, d!, 12)
    const items = buildActionItems(releases, today)
    const card = dailyCard(config.APP_URL, p.project_name, local.day, items, releases.length)
    const { rows: done } = await db.query<{ queued: boolean }>('select enqueue_daily_summary($1, $2, $3) as queued', [
      p.project_id,
      local.day,
      JSON.stringify({ card, items: items.length }),
    ])
    if (done[0]?.queued) queued++
  }
  return queued
}

/** Delivers every 20 seconds; checks daily summaries every minute. */
export function startNotifier(db: Db, config: Config): () => void {
  let running = false
  let ticks = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      if (ticks++ % 3 === 0) await queueDailySummaries(db, config)
      await deliverNotifications(db, config)
    } catch (err) {
      console.error('[teams] notifier failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), 20_000)
  void tick()
  return () => clearInterval(timer)
}
