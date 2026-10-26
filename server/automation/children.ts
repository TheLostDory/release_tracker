import type { Tx } from '../db/pool.js'
import type { BuildNode } from '../integrations/jenkins.js'
import { automationSettings } from './settings.js'

/**
 * A parent job (an "other job" of the Automated jobs step) that starts the
 * Load Test, Longevity and HIT jobs: the runs it starts fill their slots.
 */
export type SlotPurpose = 'LOAD_TEST' | 'LONGEVITY' | 'HIT'

type Job = { purpose: string; jobPath: string }

const norm = (p: string) => p.trim().replace(/^\/+|\/+$/g, '').toLowerCase()

const KEYWORDS: [SlotPurpose, RegExp][] = [
  ['LOAD_TEST', /load[\s_.-]?test|loadtest|perf[\s_.-]?load/i],
  ['LONGEVITY', /longevity|soak/i],
  ['HIT', /(^|[^a-z])hit([^a-z]|$)/i],
]

/** Which slot a child job belongs to: the project's job list first, then its name. */
export function childPurpose(jobPath: string, jobs: readonly Job[]): SlotPurpose | null {
  const listed = jobs.find((j) => (j.purpose === 'LOAD_TEST' || j.purpose === 'LONGEVITY' || j.purpose === 'HIT') && norm(j.jobPath) === norm(jobPath))
  if (listed) return listed.purpose as SlotPurpose
  const name = jobPath.split('/').pop() ?? jobPath
  return KEYWORDS.find(([, re]) => re.test(name))?.[0] ?? KEYWORDS.find(([, re]) => re.test(jobPath))?.[0] ?? null
}

/** The started (numbered) runs below the parent, the latest per slot. */
export function slotRuns(root: BuildNode, jobs: readonly Job[]): { purpose: SlotPurpose; jobPath: string; number: number }[] {
  const best = new Map<SlotPurpose, { purpose: SlotPurpose; jobPath: string; number: number }>()
  const walk = (n: BuildNode) => {
    for (const ch of n.children) {
      const purpose = ch.number !== null && !ch.queued ? childPurpose(ch.jobPath, jobs) : null
      if (purpose) {
        const prev = best.get(purpose)
        // Same slot twice (e.g. a re-run inside the parent): keep the latest build.
        if (!prev || (prev.jobPath === ch.jobPath && ch.number! > prev.number)) best.set(purpose, { purpose, jobPath: ch.jobPath, number: ch.number! })
      }
      walk(ch)
    }
  }
  walk(root)
  return [...best.values()]
}

type Queryable = Pick<Tx, 'query'>

/**
 * After a run's status is stored: if it is a parent, put the runs it started
 * into their slots, with their status (from the parent's tree: each node has
 * its result and report link). Returns how many slots changed.
 */
export async function attachChildren(q: Queryable, runId: string, status: BuildNode | null): Promise<number> {
  if (!status?.children.length) return 0
  const info = (await q.query<{ is_parent: boolean; automation: unknown }>('select * from parent_run_info($1)', [runId])).rows[0]
  if (!info?.is_parent) return 0
  const jobs = automationSettings(info.automation).jenkins.jobs
  let changed = 0
  for (const child of slotRuns(status, jobs)) {
    const id = (await q.query<{ id: string | null }>('select attach_child_run($1, $2, $3, $4) as id', [runId, child.purpose, child.jobPath, child.number])).rows[0]?.id
    if (!id) continue
    changed++
    // The child's own status (its result for the step, its report link).
    const childStatus = findNode(status, child.jobPath, child.number)
    if (childStatus) await q.query('select jenkins_followed_record($1, $2, null)', [id, JSON.stringify(childStatus)])
  }
  return changed
}

/** The child's node inside the parent's tree. */
function findNode(root: BuildNode, jobPath: string, number: number): BuildNode | null {
  for (const ch of root.children) {
    if (ch.jobPath === jobPath && ch.number === number) return ch
    const deeper = findNode(ch, jobPath, number)
    if (deeper) return deeper
  }
  return null
}
