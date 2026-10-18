import { Router } from 'express'
import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { notFound } from '../http/errors.js'
import { asUser, day, explainNoRows, idParam, setClause, uuid } from '../http/helpers.js'

const taskStatus = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED'])
const releaseStatus = z.enum(['ON_TRACK', 'AT_RISK', 'BLOCKED', 'WAITING_FOR_APPROVAL', 'RELEASED'])
const httpUrl = z.string().trim().max(2048).regex(/^https?:\/\/\S+$/i, 'must be an http(s) URL')

// --- Sprints -------------------------------------------------------------------

const sprintFields = {
  name: z.string().trim().min(1).max(100),
  start_date: day,
  end_date: day,
  status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED']),
}
const sprintCreate = z.strictObject({ project_id: uuid, ...sprintFields })
const sprintPatch = z.strictObject(sprintFields).partial()

const SPRINT_COLUMNS = `s.id, s.name, s.start_date, s.end_date, s.status, s.project_id,
  (select count(*)::int from releases r where r.sprint_id = s.id) as release_count`

// --- Releases --------------------------------------------------------------------

const releaseCreate = z.strictObject({
  project_id: uuid,
  sprint_id: uuid.nullable().default(null),
  name: z.string().trim().min(1).max(100),
  version: z.string().trim().min(1).max(50),
  owner_id: uuid.nullable().default(null),
  planned_deployment_date: day,
  description: z.string().trim().max(10_000).nullable().default(null),
})
const releasePatch = z
  .strictObject({
    sprint_id: uuid.nullable(),
    name: z.string().trim().min(1).max(100),
    version: z.string().trim().min(1).max(50),
    owner_id: uuid.nullable(),
    planned_deployment_date: day,
    actual_deployment_date: day.nullable(),
    description: z.string().trim().max(10_000).nullable(),
    status_override: releaseStatus.nullable(),
    status_override_reason: z.string().trim().max(2000).nullable(),
  })
  .partial()

const listQuery = z.strictObject({
  projectId: uuid.optional(),
  sprintId: z.union([uuid, z.literal('none')]).optional(),
  open: z.enum(['true', 'false']).optional(),
  deploymentFrom: day.optional(),
  deploymentTo: day.optional(),
})

/** Hard cap for one list; the UI says when it is reached. */
const LIST_LIMIT = 500

// One round trip: releases with project, sprint, owner, steps and reports.
const LIST_SQL = `
  select r.id, r.name, r.version, r.planned_deployment_date, r.actual_deployment_date,
         r.status_override, r.status_override_reason,
         json_build_object('id', p.id, 'name', p.name) as project,
         case when s.id is null then null else json_build_object('id', s.id, 'name', s.name) end as sprint,
         case when o.id is null then null else json_build_object('id', o.id, 'name', o.name) end as owner,
         coalesce((select json_agg(json_build_object(
                     'task_type', t.task_type, 'status', t.status, 'planned_date', t.planned_date,
                     'completed_at', t.completed_at, 'blocker_reason', t.blocker_reason, 'owner_id', t.owner_id)
                   order by t.position)
                   from release_tasks t where t.release_id = r.id), '[]') as tasks,
         coalesce((select json_agg(json_build_object('report_type', x.report_type, 'result', x.result))
                   from reports x where x.release_id = r.id), '[]') as reports,
         (select row_to_json(c) from (
            select jira_only, jira_only_done, code_only, no_key, matched, has_jira, error, checked_at
            from release_code_checks where release_id = r.id) c) as code_check
  from releases r
  join projects p on p.id = r.project_id
  left join sprints s on s.id = r.sprint_id
  left join users o on o.id = r.owner_id`

const DETAIL_SQL = `
  select r.id, r.name, r.version, r.description, r.planned_deployment_date, r.actual_deployment_date,
         r.status_override, r.status_override_reason, r.created_at, r.project_id,
         r.jira_version_id, r.jira_version_name,
         case when s.id is null then null else json_build_object(
           'id', s.id, 'name', s.name, 'start_date', s.start_date, 'end_date', s.end_date) end as sprint,
         case when o.id is null then null else json_build_object('id', o.id, 'name', o.name) end as owner,
         coalesce((select json_agg(json_build_object(
                     'id', t.id, 'task_type', t.task_type, 'name', t.name, 'position', t.position, 'status', t.status,
                     'planned_date', t.planned_date, 'completed_at', t.completed_at, 'owner_id', t.owner_id,
                     'notes', t.notes, 'link', t.link, 'blocker_reason', t.blocker_reason)
                   order by t.position)
                   from release_tasks t where t.release_id = r.id), '[]') as tasks,
         coalesce((select json_agg(json_build_object(
                     'id', x.id, 'report_type', x.report_type, 'status', x.status, 'result', x.result,
                     'report_url', x.report_url, 'reviewed_at', x.reviewed_at, 'notes', x.notes,
                     'reviewer', case when u.id is null then null else json_build_object('id', u.id, 'name', u.name) end)
                   order by x.report_type)
                   from reports x left join users u on u.id = x.reviewer_id where x.release_id = r.id), '[]') as reports,
         (select json_build_object(
                   'id', a.id, 'status', a.status, 'requested_at', a.requested_at, 'approved_at', a.approved_at,
                   'comments', a.comments,
                   'approver', case when u.id is null then null else json_build_object('id', u.id, 'name', u.name) end)
          from approvals a left join users u on u.id = a.approved_by where a.release_id = r.id) as approval
  from releases r
  left join sprints s on s.id = r.sprint_id
  left join users o on o.id = r.owner_id
  where r.id = $1`

// --- Workflow edits ------------------------------------------------------------------

const taskPatch = z
  .strictObject({
    status: taskStatus,
    planned_date: day.nullable(),
    completed_at: z.string().datetime({ offset: true }).nullable(),
    owner_id: uuid.nullable(),
    notes: z.string().trim().max(10_000).nullable(),
    link: httpUrl.nullable(),
    blocker_reason: z.string().trim().max(2000).nullable(),
  })
  .partial()
const reportPatch = z
  .strictObject({
    status: taskStatus,
    result: z.enum(['PASS', 'FAIL', 'WARNING', 'NOT_REVIEWED']),
    report_url: httpUrl.nullable(),
    notes: z.string().trim().max(10_000).nullable(),
  })
  .partial()
const approvalPatch = z
  .strictObject({
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    comments: z.string().trim().max(10_000).nullable(),
  })
  .partial()

export function releaseRoutes(db: Db) {
  const router = Router()

  // --- Sprints ---
  router.get('/projects/:id/sprints', async (req, res) => {
    const id = idParam(req)
    const rows = await asUser(db, req, async (tx) =>
      (await tx.query(`select ${SPRINT_COLUMNS} from sprints s where s.project_id = $1 order by s.start_date desc`, [id])).rows,
    )
    res.json(rows)
  })

  router.get('/sprints/:id', async (req, res) => {
    const id = idParam(req)
    const row = await asUser(db, req, async (tx) => (await tx.query(`select ${SPRINT_COLUMNS} from sprints s where s.id = $1`, [id])).rows[0])
    if (!row) throw notFound('Sprint not found.')
    res.json(row)
  })

  router.post('/sprints', async (req, res) => {
    const b = sprintCreate.parse(req.body)
    const row = await asUser(db, req, async (tx) =>
      (
        await tx.query(
          `insert into sprints (project_id, name, start_date, end_date, status) values ($1, $2, $3, $4, $5)
           returning id, name, start_date, end_date, status`,
          [b.project_id, b.name, b.start_date, b.end_date, b.status],
        )
      ).rows[0],
    )
    res.status(201).json(row)
  })

  router.patch('/sprints/:id', async (req, res) => {
    const id = idParam(req)
    const set = setClause(sprintPatch.parse(req.body), 2)
    if (set.empty) return res.status(204).end()
    await asUser(db, req, async (tx) => {
      const r = await tx.query(`update sprints set ${set.sql} where id = $1`, [id, ...set.values])
      if (!r.rowCount) await explainNoRows(tx, 'sprints', id, 'Sprint')
    })
    res.status(204).end()
  })

  router.delete('/sprints/:id', async (req, res) => {
    const id = idParam(req)
    await asUser(db, req, async (tx) => {
      const r = await tx.query('delete from sprints where id = $1', [id])
      if (!r.rowCount) await explainNoRows(tx, 'sprints', id, 'Sprint')
    })
    res.status(204).end()
  })

  // --- Releases ---
  router.get('/releases', async (req, res) => {
    const q = listQuery.parse(req.query)
    const where: string[] = []
    const values: unknown[] = []
    const add = (sql: string, value: unknown) => {
      values.push(value)
      where.push(sql.replace('?', `$${values.length}`))
    }
    if (q.projectId) add('r.project_id = ?', q.projectId)
    if (q.sprintId === 'none') where.push('r.sprint_id is null')
    else if (q.sprintId) add('r.sprint_id = ?', q.sprintId)
    if (q.open === 'true') where.push('r.actual_deployment_date is null')
    if (q.deploymentFrom) add('r.planned_deployment_date >= ?', q.deploymentFrom)
    if (q.deploymentTo) add('r.planned_deployment_date <= ?', q.deploymentTo)
    // One sprint: chronological. Otherwise most recent targets first.
    const order = q.sprintId ? 'asc' : 'desc'
    const sql = `${LIST_SQL} ${where.length ? `where ${where.join(' and ')}` : ''}
                 order by r.planned_deployment_date ${order}, r.name limit ${LIST_LIMIT}`
    const rows = await asUser(db, req, async (tx) => (await tx.query(sql, values)).rows)
    res.json(rows)
  })

  router.get('/releases/:id', async (req, res) => {
    const id = idParam(req)
    const row = await asUser(db, req, async (tx) => (await tx.query(DETAIL_SQL, [id])).rows[0])
    if (!row) throw notFound('Release not found.')
    res.json(row)
  })

  router.post('/releases', async (req, res) => {
    const b = releaseCreate.parse(req.body)
    const row = await asUser(db, req, async (tx) =>
      (
        await tx.query(
          `insert into releases (project_id, sprint_id, name, version, owner_id, planned_deployment_date, description)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [b.project_id, b.sprint_id, b.name, b.version, b.owner_id, b.planned_deployment_date, b.description],
        )
      ).rows[0],
    )
    res.status(201).json(row)
  })

  router.patch('/releases/:id', async (req, res) => {
    const id = idParam(req)
    const set = setClause(releasePatch.parse(req.body), 2)
    if (set.empty) return res.status(204).end()
    await asUser(db, req, async (tx) => {
      const r = await tx.query(`update releases set ${set.sql} where id = $1`, [id, ...set.values])
      if (!r.rowCount) await explainNoRows(tx, 'releases', id, 'Release')
    })
    res.status(204).end()
  })

  router.delete('/releases/:id', async (req, res) => {
    const id = idParam(req)
    await asUser(db, req, async (tx) => {
      const r = await tx.query('delete from releases where id = $1', [id])
      if (!r.rowCount) await explainNoRows(tx, 'releases', id, 'Release')
    })
    res.status(204).end()
  })

  router.get('/releases/:id/activity', async (req, res) => {
    const id = idParam(req)
    const rows = await asUser(db, req, async (tx) =>
      (
        await tx.query(
          `select a.id, a.action, a.description, a.created_at,
                  case when u.id is null then null else json_build_object('id', u.id, 'name', u.name) end as "user"
           from activity_log a left join users u on u.id = a.user_id
           where a.release_id = $1 order by a.created_at desc limit 100`,
          [id],
        )
      ).rows,
    )
    res.json(rows)
  })

  // --- Workflow edits (steps, reports, approval) ---
  const patchRoute = (path: string, table: string, what: string, schema: z.ZodType<Record<string, unknown>>) =>
    router.patch(path, async (req, res) => {
      const id = idParam(req)
      const set = setClause(schema.parse(req.body), 2)
      if (set.empty) return res.status(204).end()
      await asUser(db, req, async (tx) => {
        const r = await tx.query(`update ${table} set ${set.sql} where id = $1`, [id, ...set.values])
        if (!r.rowCount) await explainNoRows(tx, table, id, what)
      })
      res.status(204).end()
    })
  patchRoute('/tasks/:id', 'release_tasks', 'Step', taskPatch)
  patchRoute('/reports/:id', 'reports', 'Report', reportPatch)
  patchRoute('/approvals/:id', 'approvals', 'Approval', approvalPatch)

  // --- Search ---
  router.get('/search', async (req, res) => {
    const q = z.string().max(100).default('').parse(req.query.q)
    const rows = await asUser(db, req, async (tx) => (await tx.query('select * from search_releases($1, 20)', [q])).rows)
    res.json(rows)
  })

  return router
}
