import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  RELEASE_STATUS_LABELS,
  REPORT_RESULT_LABELS,
  SPRINT_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from '@/lib/status-labels'
import { RELEASE_STATUS_ICONS } from '@/lib/status-icons'
import type { ReleaseStatus, ReportResult, SprintStatus, TaskStatus } from '@/types/domain'

const SPRINT_STATUS_CLASS: Record<SprintStatus, string> = {
  PLANNED: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  COMPLETED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
}

export function SprintStatusBadge({ status }: { status: SprintStatus }) {
  return <Badge className={cn('font-normal', SPRINT_STATUS_CLASS[status])}>{SPRINT_STATUS_LABELS[status]}</Badge>
}

const TASK_STATUS_CLASS: Record<TaskStatus, string> = {
  NOT_STARTED: 'bg-muted text-muted-foreground',
  IN_PROGRESS: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  COMPLETED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  BLOCKED: 'bg-red-500/10 text-red-700 dark:text-red-400',
  SKIPPED: 'bg-muted text-muted-foreground line-through',
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge className={cn('font-normal', TASK_STATUS_CLASS[status])}>{TASK_STATUS_LABELS[status]}</Badge>
}

const RELEASE_STATUS_CLASS: Record<ReleaseStatus, string> = {
  ON_TRACK: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  AT_RISK: 'bg-amber-500/15 text-amber-800 dark:text-amber-400',
  BLOCKED: 'bg-red-500/10 text-red-700 dark:text-red-400',
  WAITING_FOR_APPROVAL: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  RELEASED: 'bg-muted text-muted-foreground',
}

interface ReleaseStatusBadgeProps {
  status: ReleaseStatus
  reasons?: readonly string[]
  overridden?: boolean
  className?: string
}

/** Release status with its reasons in a tooltip. */
export function ReleaseStatusBadge({ status, reasons = [], overridden, className }: ReleaseStatusBadgeProps) {
  const Icon = RELEASE_STATUS_ICONS[status]
  const badge = (
    <Badge className={cn('font-medium', RELEASE_STATUS_CLASS[status], className)}>
      <Icon aria-hidden />
      {RELEASE_STATUS_LABELS[status]}
      {overridden && <span aria-label="manually set">*</span>}
    </Badge>
  )
  if (reasons.length === 0) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="space-y-0.5">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

const RESULT_CLASS: Record<ReportResult, string> = {
  PASS: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  WARNING: 'bg-amber-500/15 text-amber-800 dark:text-amber-400',
  FAIL: 'bg-red-500/10 text-red-700 dark:text-red-400',
  NOT_REVIEWED: 'bg-muted text-muted-foreground',
}

export function ReportResultBadge({ result }: { result: ReportResult }) {
  return <Badge className={cn('font-medium', RESULT_CLASS[result])}>{REPORT_RESULT_LABELS[result]}</Badge>
}
