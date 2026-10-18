import type { Config } from '../config.js'
import { decrypt } from '../crypto.js'
import type { Tx } from '../db/pool.js'
import { HttpError } from '../http/errors.js'
import type { GitHubConnection } from './github.js'
import type { JenkinsConnection } from './jenkins.js'
import type { JiraAuth, JiraConnection } from './jira.js'

export type IntegrationKind = 'JIRA' | 'JENKINS' | 'GITHUB'

export interface IntegrationRow {
  id: string
  project_id: string
  kind: IntegrationKind
  auth_type: JiraAuth | 'JENKINS' | 'GITHUB'
  base_url: string
  username: string | null
  settings: { projectKey?: string; repos?: string[]; headTemplate?: string }
  last_error: string | null
  last_checked_at: string | null
  ca_cert: string | null
}

const KIND_LABELS: Record<IntegrationKind, string> = { JIRA: 'Jira', JENKINS: 'Jenkins', GITHUB: 'GitHub' }

export const PUBLIC_COLUMNS = 'id, project_id, kind, auth_type, base_url, username, settings, last_error, last_checked_at, ca_cert'

export function requireKey(config: Config): string {
  if (!config.ENCRYPTION_KEY) {
    throw new HttpError(503, 'Integrations need ENCRYPTION_KEY to be configured on the server.', 'not_configured')
  }
  return config.ENCRYPTION_KEY
}

/** The project's integration of this kind, with its decrypted secret (members only). */
export async function loadIntegration(tx: Tx, config: Config, projectId: string, kind: IntegrationKind) {
  const { rows } = await tx.query<IntegrationRow>(`select ${PUBLIC_COLUMNS} from integrations where project_id = $1 and kind = $2`, [
    projectId,
    kind,
  ])
  const row = rows[0]
  if (!row) throw new HttpError(409, `${KIND_LABELS[kind]} isn't connected for this project.`, 'not_connected')
  const secretRow = await tx.query<{ s: string }>('select integration_secret($1) as s', [row.id])
  let secret: string
  try {
    secret = decrypt(secretRow.rows[0]!.s, requireKey(config))
  } catch {
    throw new HttpError(409, 'Stored credentials can no longer be read (was ENCRYPTION_KEY changed?). Re-enter them.', 'not_connected')
  }
  return { row, secret }
}

export const jiraConnection = (row: IntegrationRow, secret: string): JiraConnection => ({
  baseUrl: row.base_url,
  authType: row.auth_type as JiraAuth,
  username: row.username,
  secret,
  ca: row.ca_cert,
})

export const jenkinsConnection = (
  row: { base_url: string; username: string | null; ca_cert: string | null },
  secret: string,
): JenkinsConnection => ({
  baseUrl: row.base_url,
  username: row.username,
  secret,
  ca: row.ca_cert,
})

export const githubConnection = (row: { base_url: string; ca_cert: string | null }, secret: string): GitHubConnection => ({
  apiUrl: row.base_url,
  secret,
  ca: row.ca_cert,
})
