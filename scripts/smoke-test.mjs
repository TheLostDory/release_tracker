#!/usr/bin/env node
/**
 * End-to-end smoke test against a running Release Tracker backend
 * (local Docker stack or a hosted Supabase project).
 *
 *   SMOKE_URL=http://localhost:8800 SMOKE_KEY=<anon/publishable key> \
 *   node scripts/smoke-test.mjs
 *
 * Optional: SMOKE_EMAIL / SMOKE_PASSWORD (default charbel@example.com) and a
 * second account SMOKE_EMAIL_2 / SMOKE_PASSWORD_2 (default maya@example.com)
 * used to verify role enforcement. Creates a throwaway project ("Smoke …"),
 * exercises workflow rules, roles, invitations, search and realtime, then
 * deletes the project and everything in it.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SMOKE_URL ?? 'http://localhost:8800'
const KEY = process.env.SMOKE_KEY
const EMAIL = process.env.SMOKE_EMAIL ?? 'charbel@example.com'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'password123'
const EMAIL_2 = process.env.SMOKE_EMAIL_2 ?? 'maya@example.com'
const PASSWORD_2 = process.env.SMOKE_PASSWORD_2 ?? 'password123'
if (!KEY) {
  console.error('Set SMOKE_KEY to the anon/publishable key.')
  process.exit(2)
}

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  — ${detail}` : ''}`)
}
const section = (title) => console.log(`\n— ${title}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const client = () => createClient(URL, KEY, { auth: { persistSession: false } })

async function signIn(email, password) {
  const sb = client()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  check(`sign in as ${email}`, !error, error?.message)
  if (error) process.exit(1)
  return { sb, id: data.user.id }
}

// --- Anonymous ---------------------------------------------------------------
section('Anonymous access')
const anon = client()
const { data: anonRows } = await anon.from('releases').select('id')
check('reads nothing (RLS)', (anonRows ?? []).length === 0)
const { error: anonSearch } = await anon.rpc('search_releases', { q: 'RC' })
check('search refused', !!anonSearch)
const { error: anonCreate } = await anon.rpc('create_project', { p_name: 'nope' })
check('cannot create projects', !!anonCreate)
// Sign-up is open. Probe with an existing email so no account is created:
// an enabled server answers "already registered", a disabled one "not allowed".
const { error: signupErr } = await anon.auth.signUp({ email: EMAIL, password: 'Abcdefgh12345' })
check('sign-up is enabled', !/not allowed|signup_disabled/i.test(`${signupErr?.message} ${signupErr?.code}`), signupErr?.message)
const { error: weakErr } = await anon.auth.signUp({ email: `weak-${Date.now()}@example.com`, password: 'short' })
check('weak passwords refused', !!weakErr, 'weak password accepted')

const owner = await signIn(EMAIL, PASSWORD)
const other = await signIn(EMAIL_2, PASSWORD_2)
const stamp = Date.now().toString(36)
let projectId

try {
  // --- Project & workflow ------------------------------------------------------
  section('Project & workflow')
  const { data: pid, error: pErr } = await owner.sb.rpc('create_project', { p_name: `Smoke ${stamp}`, p_description: 'smoke test' })
  projectId = pid
  check('create project', !pErr, pErr?.message)
  const { data: myRole } = await owner.sb.from('project_members').select('role').eq('project_id', projectId).eq('user_id', owner.id).single()
  check('creator is OWNER', myRole?.role === 'OWNER', JSON.stringify(myRole))

  const { data: sprint, error: sErr } = await owner.sb
    .from('sprints').insert({ project_id: projectId, name: 'S1', start_date: '2030-01-07', end_date: '2030-01-18' }).select('id').single()
  check('create sprint', !sErr, sErr?.message)

  const { data: rel, error: rErr } = await owner.sb
    .from('releases')
    .insert({ project_id: projectId, sprint_id: sprint.id, name: `RC_${stamp}`, version: '0.0.0-smoke', owner_id: owner.id, planned_deployment_date: '2030-01-17' })
    .select('id').single()
  check('create release in sprint', !rErr, rErr?.message)
  const count = async (table, releaseId) =>
    (await owner.sb.from(table).select('*', { count: 'exact', head: true }).eq('release_id', releaseId)).count
  check(
    'full workflow: 12 steps, 3 reports, approval',
    (await count('release_tasks', rel.id)) === 12 && (await count('reports', rel.id)) === 3 && (await count('approvals', rel.id)) === 1,
  )

  const { error: noSprintErr } = await owner.sb
    .from('releases').insert({ project_id: projectId, name: `NS_${stamp}`, version: '1', planned_deployment_date: '2030-01-20' })
  check('release without a sprint allowed', !noSprintErr, noSprintErr?.message)

  const { error: dup } = await owner.sb
    .from('releases').insert({ project_id: projectId, sprint_id: sprint.id, name: `RC_${stamp}`, version: '1', planned_deployment_date: '2030-01-17' })
  check('duplicate release name in sprint rejected', dup?.message?.includes('releases_name_per_sprint_unique'), dup?.message)

  const { error: settingsErr } = await owner.sb
    .from('projects')
    .update({ enabled_steps: ['RELEASE_IDENTIFIED', 'RC_CREATION', 'AUTOMATED_JOBS', 'HIT_REVIEW', 'RC_EMAIL', 'RTP_CREATION', 'RELEASE_EMAIL', 'DEPLOYMENT'] })
    .eq('id', projectId)
  check('owner updates workflow settings', !settingsErr, settingsErr?.message)
  const { data: rel2 } = await owner.sb
    .from('releases').insert({ project_id: projectId, name: `LITE_${stamp}`, version: '1', planned_deployment_date: '2030-01-25' }).select('id').single()
  check(
    'new release follows settings: 8 steps, HIT only, no approval',
    (await count('release_tasks', rel2.id)) === 8 && (await count('reports', rel2.id)) === 1 && (await count('approvals', rel2.id)) === 0,
  )
  check('existing release keeps its 12 steps', (await count('release_tasks', rel.id)) === 12)
  const { error: reqErr } = await owner.sb.from('projects').update({ enabled_steps: ['RELEASE_IDENTIFIED'] }).eq('id', projectId)
  check('Deployment step cannot be turned off', reqErr?.message?.includes('projects_required_steps'), reqErr?.message)

  // Workflow rules
  const task = async (type, sb = owner.sb, releaseId = rel.id) =>
    (await sb.from('release_tasks').select('id,status,completed_at,blocker_reason').eq('release_id', releaseId).eq('task_type', type).single()).data
  const events = []
  const channel = owner.sb
    .channel(`smoke-${stamp}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'release_tasks', filter: `release_id=eq.${rel.id}` }, (p) => events.push(p))
  const subscribed = await Promise.race([
    new Promise((res) => channel.subscribe((s) => s === 'SUBSCRIBED' && res(true))),
    sleep(10_000).then(() => false),
  ])
  check('realtime subscription', subscribed)
  // On a fresh stack Realtime starts capturing shortly after the first subscriber.
  await sleep(3000)

  const jobs = await task('AUTOMATED_JOBS')
  await owner.sb.from('release_tasks').update({ status: 'COMPLETED' }).eq('id', jobs.id)
  check('completing a step stamps completed_at', !!(await task('AUTOMATED_JOBS')).completed_at)
  const { data: hit } = await owner.sb.from('reports').select('id').eq('release_id', rel.id).eq('report_type', 'HIT').single()
  await owner.sb.from('reports').update({ result: 'FAIL' }).eq('id', hit.id)
  const hitTask = await task('HIT_REVIEW')
  check('failed report blocks its review step', hitTask.status === 'BLOCKED' && hitTask.blocker_reason === 'HIT report failed')
  const { data: approval } = await owner.sb.from('approvals').select('id').eq('release_id', rel.id).single()
  await owner.sb.from('approvals').update({ status: 'APPROVED' }).eq('id', approval.id)
  check('approval completes the Approval step', (await task('APPROVAL')).status === 'COMPLETED')
  const { error: badLink } = await owner.sb.from('release_tasks').update({ link: 'javascript:alert(1)' }).eq('id', jobs.id)
  check('javascript: links rejected', badLink?.message?.includes('release_tasks_link_check'), badLink?.message)
  const { data: found } = await owner.sb.rpc('search_releases', { q: '0.0.0-smoke' })
  check('search finds the release, with its project', !!found?.some((r) => r.id === rel.id && r.project_name === `Smoke ${stamp}`))
  await sleep(1500)
  check('realtime events delivered', events.length >= 2, `${events.length} events`)
  await owner.sb.removeChannel(channel)

  // --- Roles ---------------------------------------------------------------------
  section(`Roles (second user: ${EMAIL_2})`)
  const { data: hidden } = await other.sb.from('projects').select('id').eq('id', projectId)
  check('non-member cannot see the project', hidden.length === 0)
  const { data: hiddenRel } = await other.sb.from('releases').select('id').eq('id', rel.id)
  check('non-member cannot see its releases', hiddenRel.length === 0)

  const { data: added, error: addErr } = await owner.sb.rpc('invite_by_email', { p_project: projectId, p_email: EMAIL_2, p_role: 'VIEWER' })
  check('owner invites existing user by email → added', added === 'added', addErr?.message ?? added)

  const { data: seen } = await other.sb.from('releases').select('id').eq('project_id', projectId)
  check('viewer sees the releases', seen.length === 3, `${seen.length}`)
  const otherStep = await task('RC_CREATION', other.sb)
  const { data: viewerUpd } = await other.sb.from('release_tasks').update({ status: 'COMPLETED' }).eq('id', otherStep.id).select('id')
  check('viewer cannot edit steps', (viewerUpd ?? []).length === 0)
  const { error: viewerInsert } = await other.sb.from('releases').insert({ project_id: projectId, name: 'x', version: '1', planned_deployment_date: '2030-01-01' })
  check('viewer cannot create releases', !!viewerInsert)
  const { error: viewerInvite } = await other.sb.rpc('invite_by_email', { p_project: projectId, p_email: 'x@example.com', p_role: 'MEMBER' })
  check('viewer cannot invite', !!viewerInvite)
  const { data: invisibleInv } = await other.sb.from('project_invitations').select('id').eq('project_id', projectId)
  check('viewer cannot list invitations', (invisibleInv ?? []).length === 0)

  await owner.sb.rpc('set_member_role', { p_project: projectId, p_user: other.id, p_role: 'MEMBER' })
  const { data: memberUpd } = await other.sb.from('release_tasks').update({ status: 'IN_PROGRESS' }).eq('id', otherStep.id).select('id')
  check('member can edit steps', (memberUpd ?? []).length === 1)
  const { data: memberDel } = await other.sb.from('releases').delete().eq('id', rel2.id).select('id')
  check('member cannot delete releases', (memberDel ?? []).length === 0)
  const { data: memberSettings } = await other.sb.from('projects').update({ name: 'hijacked' }).eq('id', projectId).select('id')
  check('member cannot change project settings', (memberSettings ?? []).length === 0)
  const { error: selfPromote } = await other.sb.rpc('set_member_role', { p_project: projectId, p_user: other.id, p_role: 'ADMIN' })
  check('member cannot promote themselves', !!selfPromote)

  await owner.sb.rpc('set_member_role', { p_project: projectId, p_user: other.id, p_role: 'ADMIN' })
  const { error: adminVsOwner } = await other.sb.rpc('set_member_role', { p_project: projectId, p_user: owner.id, p_role: 'MEMBER' })
  check('admin cannot demote the owner', !!adminVsOwner?.message?.includes('Only owners'), adminVsOwner?.message)
  const { error: adminRemoveOwner } = await other.sb.rpc('remove_member', { p_project: projectId, p_user: owner.id })
  check('admin cannot remove the owner', !!adminRemoveOwner)
  const { error: ownerInvite } = await other.sb.rpc('invite_by_email', { p_project: projectId, p_email: 'y@example.com', p_role: 'OWNER' })
  check('nobody can invite as owner', !!ownerInvite)
  const { error: lastOwner } = await owner.sb.rpc('remove_member', { p_project: projectId, p_user: owner.id })
  check('last owner cannot leave', !!lastOwner?.message?.includes('at least one owner'), lastOwner?.message)
  const { data: adminDelProject } = await other.sb.from('projects').delete().eq('id', projectId).select('id')
  check('admin cannot delete the project', (adminDelProject ?? []).length === 0)

  // --- Invitations -----------------------------------------------------------------
  section('Invitations')
  const pendingEmail = `future-${stamp}@example.com`
  const { data: pending } = await other.sb.rpc('invite_by_email', { p_project: projectId, p_email: pendingEmail, p_role: 'MEMBER' })
  check('admin invites unknown email → pending', pending === 'invited', pending)
  const { data: invList } = await owner.sb.from('project_invitations').select('id, email').eq('project_id', projectId).is('revoked_at', null)
  const pendingRow = invList.find((i) => i.email === pendingEmail)
  check('pending invitation listed for admins', !!pendingRow)
  if (pendingRow) await owner.sb.rpc('revoke_invitation', { p_invitation: pendingRow.id })

  await owner.sb.rpc('remove_member', { p_project: projectId, p_user: other.id })
  const { data: gone } = await other.sb.from('projects').select('id').eq('id', projectId)
  check('removed member loses access', gone.length === 0)

  const { data: token, error: linkErr } = await owner.sb.rpc('create_invite_link', { p_project: projectId, p_role: 'MEMBER', p_expires_in_days: 1 })
  check('create invite link', !linkErr && typeof token === 'string' && token.length > 20, linkErr?.message)
  const { data: stored } = await owner.sb.from('project_invitations').select('token_hash').eq('project_id', projectId).not('token_hash', 'is', null)
  check('only a hash of the link is stored', stored.length > 0 && stored.every((r) => r.token_hash !== token && r.token_hash.length === 64))
  const { data: info } = await other.sb.rpc('invite_link_info', { p_token: token })
  check('link shows project and role before joining', info?.[0]?.project_name === `Smoke ${stamp}` && info?.[0]?.role === 'MEMBER')
  const { data: joined, error: joinErr } = await other.sb.rpc('accept_invite_link', { p_token: token })
  check('accepting the link joins the project', joined === projectId, joinErr?.message)
  const { data: joinedRole } = await other.sb.from('project_members').select('role').eq('project_id', projectId).eq('user_id', other.id).single()
  check('joined with the link role', joinedRole?.role === 'MEMBER')
  const { error: badToken } = await other.sb.rpc('accept_invite_link', { p_token: 'not-a-real-token' })
  check('invalid link refused', !!badToken)

  const { data: links } = await owner.sb.from('project_invitations').select('id').eq('project_id', projectId).not('token_hash', 'is', null)
  for (const l of links) await owner.sb.rpc('revoke_invitation', { p_invitation: l.id })
  await owner.sb.rpc('remove_member', { p_project: projectId, p_user: other.id })
  const { error: revokedJoin } = await other.sb.rpc('accept_invite_link', { p_token: token })
  check('revoked link refused', !!revokedJoin)

  const { data: activity } = await owner.sb.from('activity_log').select('action').eq('project_id', projectId)
  const actions = new Set(activity.map((a) => a.action))
  check(
    'membership events logged',
    ['project.created', 'member.added', 'member.role_changed', 'member.removed', 'member.joined', 'invitation.revoked'].every((a) => actions.has(a)),
    [...actions].join(','),
  )
} finally {
  if (projectId) {
    const { error } = await owner.sb.from('projects').delete().eq('id', projectId)
    check('cleanup: owner deletes the project (cascades)', !error, error?.message)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
