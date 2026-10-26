import { Router } from 'express'
import { z } from 'zod'
import type { Config } from '../config.js'
import type { Db, Tx } from '../db/pool.js'
import { buildEmailDraft, type EmailData } from '../automation/email-templates.js'
import { automationSettings, EMAIL_STEPS } from '../automation/settings.js'
import { HttpError, notFound } from '../http/errors.js'
import { asUser, idParam } from '../http/helpers.js'
import { cached } from '../integrations/cache.js'
import { jiraVersionIssues } from '../integrations/jira.js'
import { jiraConnection, loadIntegration } from '../integrations/store.js'

const stepParam = z.enum(EMAIL_STEPS)

const RUN_LABEL: Record<string, string> = { LOAD_TEST: 'Load Test', LONGEVITY: 'Longevity', HIT: 'HIT' }

/** Everything the draft needs, read as the signed-in user. */
async function emailData(tx: Tx, config: Config, releaseId: string): Promise<{ data: EmailData; projectId: string; automation: unknown; notes: string[] }> {
  const notes: string[] = []
  const r = (
    await tx.query<{
      id: string
      name: string
      version: string
      project_id: string
      planned_deployment_date: string
      actual_deployment_date: string | null
      jira_version_id: string | null
      jira_version_name: string | null
      sprint: string | null
      owner: string | null
      automation: unknown
    }>(
      `select r.id, r.name, r.version, r.project_id, r.planned_deployment_date, r.actual_deployment_date, r.jira_version_id,
              r.jira_version_name, s.name as sprint, u.name as owner, p.automation
       from releases r join projects p on p.id = r.project_id
       left join sprints s on s.id = r.sprint_id left join users u on u.id = r.owner_id
       where r.id = $1`,
      [releaseId],
    )
  ).rows[0]
  if (!r) throw notFound('Release not found.')

  let jira: EmailData['jira'] = null
  if (r.jira_version_id) {
    try {
      const j = await loadIntegration(tx, config, r.project_id, 'JIRA')
      const { issues } = await cached(`issues:${j.row.id}:${r.jira_version_id}`, 60_000, () => jiraVersionIssues(jiraConnection(j.row, j.secret), r.jira_version_id!))
      jira = {
        versionName: r.jira_version_name ?? r.version,
        url: `${j.row.base_url}/projects/${j.row.settings.projectKey}/versions/${r.jira_version_id}`,
        issues: issues.map((i) => ({ key: i.key, summary: i.summary, type: i.type, status: i.status, url: i.url })),
      }
    } catch (err) {
      notes.push(`Jira issues couldn't be read (${(err as Error).message}); the content list is missing.`)
    }
  }

  const runs = (
    await tx.query<{ purpose: string; job_path: string; status: { name?: string; result?: string | null; building?: boolean; url?: string; reportUrl?: string | null } | null }>(
      `select purpose::text, job_path, status from release_jenkins_builds where release_id = $1 and purpose is not null order by created_at`,
      [releaseId],
    )
  ).rows.map((x) => ({
    label: RUN_LABEL[x.purpose] ?? x.job_path,
    name: x.status?.name ?? x.job_path,
    result: x.status?.result ?? null,
    building: x.status?.building ?? false,
    url: x.status?.url ?? '',
    reportUrl: x.status?.reportUrl ?? null,
  }))

  const reports = (await tx.query<{ type: string; result: string; url: string | null }>(
    'select report_type::text as type, result::text as result, report_url as url from reports where release_id = $1 order by report_type',
    [releaseId],
  )).rows

  const check = (await tx.query<{ jira_only: number; code_only: number; no_key: number; matched: number; has_jira: boolean; error: string | null }>(
    'select jira_only, code_only, no_key, matched, has_jira, error from release_code_checks where release_id = $1',
    [releaseId],
  )).rows[0]

  const open = (await tx.query<{ name: string; status: string; planned_date: string | null; blocker_reason: string | null; overdue: boolean }>(
    `select name, status::text, planned_date, blocker_reason, (planned_date < current_date) as overdue
     from release_tasks where release_id = $1 and status not in ('COMPLETED', 'SKIPPED') order by position`,
    [releaseId],
  )).rows
  const openItems = open
    .filter((t) => t.status === 'BLOCKED' || t.overdue)
    .map((t) => (t.status === 'BLOCKED' ? `${t.name}: blocked${t.blocker_reason ? ` (${t.blocker_reason})` : ''}` : `${t.name}: overdue since ${t.planned_date}`))

  const approvalRow = (await tx.query<{ status: string; due: string | null }>(
    `select a.status::text, (select planned_date from release_tasks where release_id = $1 and task_type = 'APPROVAL') as due
     from approvals a where a.release_id = $1`,
    [releaseId],
  )).rows[0]

  return {
    projectId: r.project_id,
    automation: r.automation,
    notes,
    data: {
      appUrl: config.APP_URL,
      release: {
        id: r.id,
        name: r.name,
        version: r.version,
        targetDate: r.planned_deployment_date,
        deployedDate: r.actual_deployment_date,
        sprint: r.sprint,
        owner: r.owner,
      },
      jira,
      runs,
      reports,
      codeCheck: check && check.has_jira && !check.error ? { jiraOnly: check.jira_only, codeOnly: check.code_only, noKey: check.no_key, matched: check.matched } : null,
      openItems,
      approval: approvalRow ? { status: approvalRow.status, dueDate: approvalRow.due } : null,
    },
  }
}

export function emailRoutes(db: Db, config: Config) {
  const router = Router()

  /** A draft of the RC / escalation / release email, with the project's recipients. */
  router.get('/releases/:id/emails/:step', async (req, res) => {
    const releaseId = idParam(req)
    const parsed = stepParam.safeParse(req.params.step)
    if (!parsed.success) throw new HttpError(404, 'No such email.', 'not_found')
    const step = parsed.data
    const { data, automation, notes } = await asUser(db, req, (tx) => emailData(tx, config, releaseId))
    const recipients = automationSettings(automation).emails.recipients[step]
    res.json({ step, ...recipients, ...buildEmailDraft(step, data), notes })
  })

  return router
}
