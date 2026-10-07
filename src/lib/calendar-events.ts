import type { TaskStatus, WorkflowTaskType } from '@/types/domain'
import { daysFromToday, toDayString, type DayString } from './dates'
import { STEP_BY_TYPE } from './workflow'

/**
 * Calendar/timeline events derived from releases. Pure; `today` injectable.
 *
 * Placement rules:
 *   - completed step     → the local day it was completed
 *   - open/blocked step  → its planned day (skipped steps are omitted)
 *   - release            → its target deployment day, or the actual day once deployed
 */

export type EventState = 'done' | 'overdue' | 'today' | 'open' | 'blocked'

export interface CalendarEvent {
  id: string
  day: DayString
  releaseId: string
  releaseName: string
  /** 'target' = planned deployment of the release itself. */
  kind: 'step' | 'target'
  taskType: WorkflowTaskType | null
  label: string
  short: string
  state: EventState
  ownerId: string | null
}

export interface EventRelease {
  id: string
  name: string
  planned_deployment_date: string
  actual_deployment_date: string | null
  owner: { id: string } | null
  tasks: readonly {
    task_type: WorkflowTaskType
    status: TaskStatus
    planned_date: string | null
    completed_at: string | null
    owner_id: string | null
  }[]
}

function openState(day: DayString, today: Date): EventState {
  const diff = daysFromToday(day, today)
  return diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'open'
}

export function buildCalendarEvents(releases: readonly EventRelease[], today = new Date()): CalendarEvent[] {
  const events: CalendarEvent[] = []
  for (const r of releases) {
    for (const t of r.tasks) {
      // The release's target marker stands in for the deployment step.
      if (t.status === 'SKIPPED' || t.task_type === 'DEPLOYMENT') continue
      const step = STEP_BY_TYPE[t.task_type]
      const done = t.status === 'COMPLETED'
      const day = done ? (t.completed_at ? toDayString(new Date(t.completed_at)) : t.planned_date) : t.planned_date
      if (!day) continue
      events.push({
        id: `${r.id}:${t.task_type}`,
        day,
        releaseId: r.id,
        releaseName: r.name,
        kind: 'step',
        taskType: t.task_type,
        label: step.name,
        short: step.short,
        state: done ? 'done' : t.status === 'BLOCKED' ? 'blocked' : openState(day, today),
        ownerId: t.owner_id,
      })
    }

    const deployed = r.actual_deployment_date !== null
    const day = r.actual_deployment_date ?? r.planned_deployment_date
    events.push({
      id: `${r.id}:target`,
      day,
      releaseId: r.id,
      releaseName: r.name,
      kind: 'target',
      taskType: 'DEPLOYMENT',
      label: deployed ? 'Deployed' : 'Target deployment',
      short: deployed ? 'Deployed' : 'Deploy',
      state: deployed ? 'done' : openState(day, today),
      ownerId: r.tasks.find((t) => t.task_type === 'DEPLOYMENT')?.owner_id ?? r.owner?.id ?? null,
    })
  }
  return events
}

/** Events per day; within a day: targets first, then by release, then workflow order. */
export function groupByDay(events: readonly CalendarEvent[]): Map<DayString, CalendarEvent[]> {
  const byDay = new Map<DayString, CalendarEvent[]>()
  for (const e of events) {
    const list = byDay.get(e.day)
    if (list) list.push(e)
    else byDay.set(e.day, [e])
  }
  const order = (e: CalendarEvent) => (e.kind === 'target' ? -1 : e.taskType ? Object.keys(STEP_BY_TYPE).indexOf(e.taskType) : 99)
  for (const list of byDay.values()) {
    list.sort((a, b) => order(a) - order(b) || a.releaseName.localeCompare(b.releaseName))
  }
  return byDay
}

export interface Conflict {
  kind: 'deployments' | 'owner'
  message: string
}

/**
 * Days that need a second look:
 *   - two or more releases target deployment the same day
 *   - one person owns open steps of two or more releases the same day
 */
export function detectConflicts(
  byDay: ReadonlyMap<DayString, readonly CalendarEvent[]>,
  ownerName: (id: string) => string = (id) => id,
): Map<DayString, Conflict[]> {
  const result = new Map<DayString, Conflict[]>()
  for (const [day, events] of byDay) {
    const conflicts: Conflict[] = []
    const deploying = [...new Set(events.filter((e) => e.kind === 'target' && e.state !== 'done').map((e) => e.releaseName))]
    if (deploying.length > 1) {
      conflicts.push({ kind: 'deployments', message: `${deploying.join(', ')} all deploy on this day` })
    }

    const releasesByOwner = new Map<string, Set<string>>()
    for (const e of events) {
      // Deployment markers are covered by the deployments conflict above.
      if (!e.ownerId || e.state === 'done' || e.kind === 'target') continue
      const set = releasesByOwner.get(e.ownerId) ?? new Set<string>()
      set.add(e.releaseName)
      releasesByOwner.set(e.ownerId, set)
    }
    for (const [owner, releases] of releasesByOwner) {
      if (releases.size > 1) {
        conflicts.push({ kind: 'owner', message: `${ownerName(owner)} has work on ${[...releases].join(', ')}` })
      }
    }
    if (conflicts.length) result.set(day, conflicts)
  }
  return result
}
