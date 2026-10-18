import type { ActionItem } from '../../src/lib/action-items.js'
import type { AdaptiveElement, TeamsCard } from '../integrations/teams.js'

/**
 * Adaptive Card content for Teams messages. Teams renders a little Markdown
 * in text, so names and reasons are escaped (SP_III_2026 must not turn italic,
 * and nobody can inject a link).
 */
export const md = (s: unknown) => String(s ?? '').replace(/[\\`*_[\]~]/g, (c) => `\\${c}`)

interface ReleaseRef {
  id: string
  name: string
  version: string
}

/** What the database queues (see migration 0011). */
export type OutboxEvent =
  | { kind: 'blocked'; payload: { release: ReleaseRef; step: string; reason: string | null; by: string } }
  | { kind: 'jenkins'; payload: { release: ReleaseRef; description: string; result: string | null; url: string | null } }
  | { kind: 'daily'; payload: { card: TeamsCard; items: number } }

export type ReleaseEvent = Exclude<OutboxEvent, { kind: 'daily' }>

const text = (t: string, extra: Record<string, unknown> = {}): AdaptiveElement => ({ type: 'TextBlock', text: t, wrap: true, ...extra })
const openUrl = (title: string, url: string): AdaptiveElement => ({ type: 'Action.OpenUrl', title, url })
const releaseUrl = (appUrl: string, id: string) => `${appUrl.replace(/\/+$/, '')}/releases/${id}`

const RESULT_ICON: Record<string, string> = { SUCCESS: '✅', UNSTABLE: '🟡', FAILURE: '❌', ABORTED: '⏹️' }

/** One card per release: everything that happened to it in this batch. */
export function releaseCard(appUrl: string, release: ReleaseRef, events: ReleaseEvent[]): TeamsCard {
  const lines = events.map((e) => {
    if (e.kind === 'blocked') {
      const p = e.payload
      return `⛔ **${md(p.step)} blocked**${p.reason ? `: ${md(p.reason)}` : ''} (by ${md(p.by)})`
    }
    const icon = RESULT_ICON[String(e.payload.result ?? '')] ?? '🔔'
    return `${icon} ${md(String(e.payload.description).replace(/^Jenkins: /, 'Jenkins '))}`
  })
  const jenkinsLinks = events.flatMap((e) => (e.kind === 'jenkins' && e.payload.url ? [e.payload.url] : [])).slice(0, 2)
  return {
    body: [
      text(`${md(release.name)} · ${md(release.version)}`, { size: 'Medium', weight: 'Bolder' }),
      ...lines.map((l) => text(l, { spacing: 'Small' })),
    ],
    actions: [
      openUrl('Open release', releaseUrl(appUrl, release.id)),
      ...jenkinsLinks.map((url, i) => openUrl(jenkinsLinks.length > 1 ? `Open build ${i + 1}` : 'Open build', url)),
    ],
  }
}

const SEVERITY_ICON: Record<ActionItem['severity'], string> = { critical: '🔴', warning: '🟠', info: '🔵' }
const MAX_ITEMS = 20

/** The morning summary: the dashboard's "Action required" list for one project. */
export function dailyCard(appUrl: string, projectName: string, day: string, items: ActionItem[], openReleases: number): TeamsCard {
  const body: AdaptiveElement[] = [
    text(`${md(projectName)}: release summary`, { size: 'Medium', weight: 'Bolder' }),
    text(`${day} · ${openReleases} open release${openReleases === 1 ? '' : 's'}`, { isSubtle: true, spacing: 'None' }),
  ]
  if (items.length === 0) {
    body.push(text('✅ Nothing needs action today.'))
  } else {
    const critical = items.filter((i) => i.severity === 'critical').length
    body.push(text(`**${items.length} item${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} action**${critical ? ` (${critical} urgent)` : ''}`))
    for (const item of items.slice(0, MAX_ITEMS)) {
      body.push(
        text(`${SEVERITY_ICON[item.severity]} [${md(item.releaseName)}](${releaseUrl(appUrl, item.releaseId)}) — ${md(item.title)}${item.detail ? `: ${md(item.detail)}` : ''}`, {
          spacing: 'Small',
        }),
      )
    }
    if (items.length > MAX_ITEMS) body.push(text(`…and ${items.length - MAX_ITEMS} more on the dashboard.`, { isSubtle: true }))
  }
  return { body, actions: [openUrl('Open dashboard', appUrl.replace(/\/+$/, '') + '/')] }
}

export function testCard(appUrl: string, projectName: string): TeamsCard {
  return {
    body: [
      text('Release Tracker is connected', { size: 'Medium', weight: 'Bolder' }),
      text(`This channel will receive notifications for **${md(projectName)}**.`),
    ],
    actions: [openUrl('Open Release Tracker', appUrl)],
  }
}
