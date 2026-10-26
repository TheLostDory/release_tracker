import type { Config } from '../config.js'
import { HttpError } from '../http/errors.js'
import { outbound } from './outbound.js'

/**
 * Microsoft Teams through a Workflows webhook ("Post to a channel when a
 * webhook request is received"): we POST an Adaptive Card. The webhook URL is
 * the credential, so it's stored encrypted and only sent to Microsoft hosts.
 */
const SERVICE = 'Teams'

export interface TeamsSettings {
  events: { blocked: boolean; jenkins: boolean; daily: boolean; code?: boolean; dueSoon?: boolean; approval?: boolean }
  /** "HH:MM", in `timezone`. */
  dailyTime: string
  timezone: string
  weekdaysOnly: boolean
}

export const DEFAULT_TEAMS_SETTINGS: TeamsSettings = {
  events: { blocked: true, jenkins: true, daily: true },
  dailyTime: '09:00',
  timezone: 'UTC',
  weekdaysOnly: true,
}

/** Validates a pasted webhook URL; returns it normalized or throws a 422 saying why. */
export function checkWebhookUrl(raw: string, config: Config): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new HttpError(422, 'Paste the full webhook URL that Teams Workflows gave you (https://…).', 'invalid')
  }
  const allowed = config.TEAMS_WEBHOOK_HOSTS.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  const host = url.hostname.toLowerCase()
  const ok = allowed.some((h) => host === h || host.endsWith(`.${h}`))
  if (!ok) {
    throw new HttpError(422, `That doesn't look like a Teams Workflows webhook (${host}). Copy the URL from the workflow's "When a Teams webhook request is received" step.`, 'invalid')
  }
  const local = host === '127.0.0.1' || host === 'localhost'
  if (url.protocol !== 'https:' && !local) throw new HttpError(422, 'The webhook URL must start with https://', 'invalid')
  if (url.username || url.password) throw new HttpError(422, "Don't put credentials in the URL.", 'invalid')
  return url.toString()
}

export type AdaptiveElement = Record<string, unknown>

export interface TeamsCard {
  body: AdaptiveElement[]
  actions?: AdaptiveElement[]
}

/** Posts one Adaptive Card to the channel. */
export async function postTeamsCard(webhookUrl: string, card: TeamsCard, ca?: string | null) {
  const res = await outbound(webhookUrl, SERVICE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            msteams: { width: 'Full' },
            body: card.body,
            ...(card.actions?.length ? { actions: card.actions } : {}),
          },
        },
      ],
    }),
    ca,
    errorDetail: true,
  })
  await res.text()
}
