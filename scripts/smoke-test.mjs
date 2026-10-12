#!/usr/bin/env node
/**
 * End-to-end smoke test against a running Release Tracker backend
 * (local Docker stack or a hosted Supabase project).
 *
 *   SMOKE_URL=http://localhost:8800 SMOKE_KEY=<anon/publishable key> \
 *   SMOKE_EMAIL=charbel@example.com SMOKE_PASSWORD=password123 \
 *   node scripts/smoke-test.mjs
 *
 * Creates a throwaway sprint + release ("Smoke …"), exercises the workflow
 * rules, RLS, search and realtime, then deletes everything it created.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SMOKE_URL ?? 'http://localhost:8800'
const KEY = process.env.SMOKE_KEY
const EMAIL = process.env.SMOKE_EMAIL ?? 'charbel@example.com'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'password123'
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const opts = { auth: { persistSession: false } }

// --- Anonymous access is refused -------------------------------------------
const anon = createClient(URL, KEY, opts)
const { data: anonRows } = await anon.from('releases').select('id')
check('anonymous read returns nothing (RLS)', (anonRows ?? []).length === 0)
const { error: anonSearch } = await anon.rpc('search_releases', { q: 'RC' })
check('anonymous search refused', !!anonSearch)
const { error: signupErr } = await anon.auth.signUp({ email: `intruder-${Date.now()}@example.com`, password: 'Abcdefgh12345' })
check('self sign-up disabled', !!signupErr, 'sign-up succeeded')

// --- Signed in ---------------------------------------------------------------
const sb = createClient(URL, KEY, opts)
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
check(`sign in as ${EMAIL}`, !authErr, authErr?.message)
if (authErr) process.exit(1)
const me = auth.user.id

const stamp = Date.now().toString(36)
const { data: sprint, error: sErr } = await sb
  .from('sprints')
  .insert({ name: `Smoke ${stamp}`, start_date: '2030-01-07', end_date: '2030-01-18' })
  .select('id')
  .single()
check('create sprint', !sErr, sErr?.message)

let rel
try {
  const { data, error } = await sb
    .from('releases')
    .insert({ sprint_id: sprint.id, name: `RC_${stamp}`, version: '0.0.0-smoke', owner_id: me, planned_deployment_date: '2030-01-17' })
    .select('id')
    .single()
  check('create release', !error, error?.message)
  rel = data

  const task = async (type) =>
    (await sb.from('release_tasks').select('id,status,completed_at,blocker_reason').eq('release_id', rel.id).eq('task_type', type).single()).data
  const { count: taskCount } = await sb.from('release_tasks').select('*', { count: 'exact', head: true }).eq('release_id', rel.id)
  const { count: reportCount } = await sb.from('reports').select('*', { count: 'exact', head: true }).eq('release_id', rel.id)
  check('12 workflow steps + 3 reports created automatically', taskCount === 12 && reportCount === 3, `${taskCount}/${reportCount}`)

  const { error: dup } = await sb.from('releases').insert({ sprint_id: sprint.id, name: `RC_${stamp}`, version: '1', planned_deployment_date: '2030-01-17' })
  check('duplicate release name rejected', dup?.message?.includes('releases_name_per_sprint_unique'), dup?.message)

  // Realtime: subscribe, then change a step.
  const events = []
  const channel = sb
    .channel(`smoke-${stamp}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'release_tasks', filter: `release_id=eq.${rel.id}` }, (p) => events.push(p))
  const subscribed = await Promise.race([
    new Promise((res) => channel.subscribe((s) => s === 'SUBSCRIBED' && res(true))),
    sleep(10_000).then(() => false),
  ])
  check('realtime subscription', subscribed)
  // On a fresh stack Realtime starts capturing changes shortly after the
  // first subscriber joins; give it a moment so the test isn't racing it.
  await sleep(3000)

  const jobs = await task('AUTOMATED_JOBS')
  await sb.from('release_tasks').update({ status: 'COMPLETED' }).eq('id', jobs.id)
  check('completing a step stamps completed_at', !!(await task('AUTOMATED_JOBS')).completed_at)

  const { data: hit } = await sb.from('reports').select('id').eq('release_id', rel.id).eq('report_type', 'HIT').single()
  await sb.from('reports').update({ result: 'FAIL' }).eq('id', hit.id)
  const hitTask = await task('HIT_REVIEW')
  check('failed report blocks its review step', hitTask.status === 'BLOCKED' && hitTask.blocker_reason === 'HIT report failed', JSON.stringify(hitTask))

  const { data: approval } = await sb.from('approvals').select('id').eq('release_id', rel.id).single()
  await sb.from('approvals').update({ status: 'APPROVED' }).eq('id', approval.id)
  check('approval completes the Approval step', (await task('APPROVAL')).status === 'COMPLETED')

  const { error: badLink } = await sb.from('release_tasks').update({ link: 'javascript:alert(1)' }).eq('id', jobs.id)
  check('javascript: links rejected', badLink?.message?.includes('release_tasks_link_check'), badLink?.message)

  const { data: activity } = await sb.from('activity_log').select('description, user_id').eq('release_id', rel.id)
  check('activity logged with actor', activity.length >= 4 && activity.every((a) => a.user_id === me), `${activity.length} entries`)

  const { data: found, error: searchErr } = await sb.rpc('search_releases', { q: '0.0.0-smoke' })
  check('search finds the release by version', !searchErr && found.some((r) => r.id === rel.id), searchErr?.message)

  await sleep(1500)
  check('realtime events delivered', events.length >= 2, `${events.length} events`)
  await sb.removeChannel(channel)
} finally {
  if (rel) await sb.from('releases').delete().eq('id', rel.id)
  if (sprint) {
    const { error } = await sb.from('sprints').delete().eq('id', sprint.id)
    check('cleanup', !error, error?.message)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
