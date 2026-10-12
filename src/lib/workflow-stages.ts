import type { TaskStatus, WorkflowTaskType } from '@/types/domain'
import { isDone, STEP_BY_TYPE, WORKFLOW_STAGES } from './workflow'

export type StageState = 'done' | 'skipped' | 'current' | 'blocked' | 'in_progress' | 'todo'

export interface StageTask {
  task_type: WorkflowTaskType
  status: TaskStatus
  planned_date: string | null
  completed_at?: string | null
}

export interface StageSummary {
  name: string
  state: StageState
  /** Done steps / total steps in the stage (e.g. Reports 2/3). */
  done: number
  total: number
  /** Latest completion (if done) or latest planned date of the stage. */
  completedAt: string | null
  plannedDate: string | null
}

/** Milestones shown on dashboard cards (a subset of the full timeline). */
export const CARD_MILESTONES = ['RC created', 'Automated jobs', 'Reports', 'RTP', 'Approval', 'Deployment'] as const

function stateOf(statuses: TaskStatus[], isCurrent: boolean): StageState {
  if (statuses.some((s) => s === 'BLOCKED')) return 'blocked'
  if (statuses.length > 0 && statuses.every((s) => s === 'SKIPPED')) return 'skipped'
  if (statuses.every(isDone)) return 'done'
  if (isCurrent) return 'current'
  return statuses.some((s) => s === 'IN_PROGRESS' || s === 'COMPLETED') ? 'in_progress' : 'todo'
}

/** Collapses steps into timeline stages; `current` is the next-action step. */
export function summarizeStages(
  tasks: readonly StageTask[],
  current: WorkflowTaskType | null,
  stages: readonly string[] = WORKFLOW_STAGES,
): StageSummary[] {
  const currentStage = current ? STEP_BY_TYPE[current].stage : null
  // Stages with no steps (turned off in the project) are left out.
  const present = stages.filter((name) => tasks.some((t) => STEP_BY_TYPE[t.task_type].stage === name))
  return present.map((name) => {
    const inStage = tasks.filter((t) => STEP_BY_TYPE[t.task_type].stage === name)
    const latest = (values: (string | null | undefined)[]) =>
      values.filter((v): v is string => !!v).sort().at(-1) ?? null
    const state = stateOf(
      inStage.map((t) => t.status),
      name === currentStage,
    )
    return {
      name,
      state,
      done: inStage.filter((t) => isDone(t.status)).length,
      total: inStage.length,
      completedAt: state === 'done' ? latest(inStage.map((t) => t.completed_at)) : null,
      plannedDate: latest(inStage.map((t) => t.planned_date)),
    }
  })
}
