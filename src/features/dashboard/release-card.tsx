import { memo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, Minus, X } from 'lucide-react'
import { ReleaseStatusBadge } from '@/components/status-badges'
import { DueDate } from '@/features/releases/due-date'
import type { ReleaseListItem } from '@/features/releases/api'
import { usePrefetchRelease } from '@/features/releases/queries'
import type { ReleaseSummary } from '@/features/releases/release-summary'
import { formatDay } from '@/lib/dates'
import { ATTENTION_SURFACE, ATTENTION_TEXT } from '@/lib/attention-styles'
import { cn } from '@/lib/utils'
import { CARD_MILESTONES, summarizeStages, type StageState } from '@/lib/workflow-stages'

const MARK: Record<StageState, { icon: ReactNode; className: string; label: string }> = {
  done: { icon: <Check className="size-3.5" strokeWidth={3} />, className: 'text-emerald-600 dark:text-emerald-400', label: 'done' },
  skipped: { icon: <Minus className="size-3.5" />, className: 'text-muted-foreground', label: 'skipped' },
  blocked: { icon: <X className="size-3.5" strokeWidth={3} />, className: 'text-red-600 dark:text-red-400', label: 'blocked' },
  current: { icon: <ArrowRight className="size-3.5" strokeWidth={2.5} />, className: 'text-blue-600 dark:text-blue-400', label: 'current' },
  in_progress: { icon: <span className="size-2 rounded-full border-2 border-current" />, className: 'text-blue-600/70', label: 'in progress' },
  todo: { icon: <span className="size-2 rounded-full border border-current" />, className: 'text-muted-foreground/60', label: 'not started' },
}

interface Props {
  release: ReleaseListItem
  summary: ReleaseSummary
}

export const ReleaseCard = memo(function ReleaseCard({ release, summary }: Props) {
  const stages = summarizeStages(release.tasks, summary.next?.type ?? null, CARD_MILESTONES)
  const { status, next } = summary
  const prefetch = usePrefetchRelease()

  return (
    <Link
      to={`/releases/${release.id}`}
      onMouseEnter={() => prefetch(release.id)}
      onFocus={() => prefetch(release.id)}
      className={cn(
        'group flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/25',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        ATTENTION_SURFACE[status.status],
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold group-hover:underline">
            {release.name}
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{release.version}</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            Target {formatDay(release.planned_deployment_date)}
            {!release.actual_deployment_date && (
              <>
                {' · '}
                <DueDate day={release.planned_deployment_date} />
              </>
            )}
            {release.owner && ` · ${release.owner.name}`}
          </p>
        </div>
        {/* No tooltip here: it would nest a focusable element inside the link. Reasons are shown below. */}
        <ReleaseStatusBadge status={status.status} overridden={status.overridden} />
      </div>

      <ol className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-label="Milestones">
        {stages.map((s) => {
          const mark = MARK[s.state]
          return (
            <li key={s.name} className="flex items-center gap-2">
              <span className={cn('flex size-4 items-center justify-center', mark.className)} aria-hidden>
                {mark.icon}
              </span>
              <span
                className={cn(
                  'truncate',
                  s.state === 'current' ? 'font-medium' : s.state === 'todo' || s.state === 'skipped' ? 'text-muted-foreground' : '',
                )}
              >
                {s.name}
                {s.total > 1 && <span className="ml-1 text-xs text-muted-foreground tabular-nums">{s.done}/{s.total}</span>}
              </span>
              <span className="sr-only">({mark.label})</span>
            </li>
          )
        })}
      </ol>

      <div className="mt-auto border-t pt-3 text-sm">
        {next ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              <span className="text-xs text-muted-foreground">Next </span>
              <span className={cn('font-medium', next.blocked && 'text-red-600 dark:text-red-400')}>{next.label}</span>
            </span>
            {next.due && <DueDate day={next.due} showDate className="shrink-0 text-xs" />}
          </div>
        ) : (
          <span className="text-muted-foreground">
            {release.actual_deployment_date ? `Deployed ${formatDay(release.actual_deployment_date)}` : 'No open steps'}
          </span>
        )}
        {status.reasons[0] && status.status !== 'ON_TRACK' && status.status !== 'RELEASED' && (
          <p className={cn('mt-1 truncate text-xs font-medium', ATTENTION_TEXT[status.status] ?? 'text-muted-foreground')} title={status.reasons.join('\n')}>
            {status.reasons[0]}
            {status.reasons.length > 1 && ` (+${status.reasons.length - 1} more)`}
          </p>
        )}
      </div>
    </Link>
  )
})
