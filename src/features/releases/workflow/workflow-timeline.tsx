import { Check, Minus, X } from 'lucide-react'
import { formatDay, formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { summarizeStages, type StageState } from '@/lib/workflow-stages'
import type { WorkflowTaskType } from '@/types/domain'
import type { ReleaseTask } from '../api'

const DOT: Record<StageState, string> = {
  done: 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500',
  skipped: 'border-muted-foreground/40 bg-muted text-muted-foreground',
  current: 'border-blue-600 bg-background ring-4 ring-blue-500/20 dark:border-blue-400',
  in_progress: 'border-blue-600/60 bg-background dark:border-blue-400/60',
  blocked: 'border-red-600 bg-red-600 text-white',
  todo: 'border-border bg-background',
}

/** Horizontal stage tracker; review steps collapse into one "Reports" node. */
export function WorkflowTimeline({ tasks, current }: { tasks: readonly ReleaseTask[]; current: WorkflowTaskType | null }) {
  const stages = summarizeStages(tasks, current).map((s) => ({
    ...s,
    date: s.completedAt ? formatTimestamp(s.completedAt, 'MMM d') : s.plannedDate ? formatDay(s.plannedDate) : null,
    detail: s.total > 1 ? `${s.done}/${s.total}` : null,
  }))
  return (
    <ol className="flex overflow-x-auto pb-2" aria-label="Workflow progress">
      {stages.map((s, i) => (
        <li
          key={s.name}
          className="relative flex min-w-20 flex-1 flex-col items-center text-center"
          aria-current={s.state === 'current' ? 'step' : undefined}
        >
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-2.5 right-1/2 h-px w-full -translate-y-1/2',
                s.state === 'done' || s.state === 'skipped' ? 'bg-emerald-600/50' : 'bg-border',
              )}
            />
          )}
          <span
            className={cn('relative z-[1] flex size-5 items-center justify-center rounded-full border-2', DOT[s.state])}
          >
            {s.state === 'done' && <Check className="size-3" strokeWidth={3} />}
            {s.state === 'skipped' && <Minus className="size-3" strokeWidth={3} />}
            {s.state === 'blocked' && <X className="size-3" strokeWidth={3} />}
            {s.state === 'current' && <span className="size-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />}
          </span>
          <span
            className={cn(
              'mt-1.5 px-1 text-xs leading-tight',
              s.state === 'current' ? 'font-semibold text-foreground' : s.state === 'blocked' ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground',
            )}
          >
            {s.name}
            {s.detail && <span className="ml-1 tabular-nums">{s.detail}</span>}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">{s.date ?? ' '}</span>
          <span className="sr-only">
            {s.state === 'current' ? 'current stage' : s.state.replace('_', ' ')}
          </span>
        </li>
      ))}
    </ol>
  )
}
