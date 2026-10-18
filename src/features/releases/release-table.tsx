import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { ProgressBar } from '@/components/progress-bar'
import { ReleaseStatusBadge } from '@/components/status-badges'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CodeCheckBadge } from '@/features/integrations/code-check-badge'
import { useConnected } from '@/features/integrations/queries'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { DueDate } from '@/features/releases/due-date'
import { useToday } from '@/hooks/use-today'
import { formatDay, parseDay } from '@/lib/dates'
import type { ReleaseListItem } from './api'
import { usePrefetchRelease } from './queries'
import { summarizeRelease } from './release-summary'

interface Props {
  releases: readonly ReleaseListItem[]
  showSprint?: boolean
}

export function ReleaseTable({ releases, showSprint = false }: Props) {
  const navigate = useNavigate()
  // "Code vs Jira" needs GitHub; the column appears once it's connected.
  const { currentProject } = useCurrentProject()
  const { github } = useConnected(currentProject?.id)
  const prefetch = usePrefetchRelease()
  // Status needs every step; compute once per data change, not per render.
  const today = useToday()
  const rows = useMemo(
    () => releases.map((r) => ({ release: r, summary: summarizeRelease(r, parseDay(today)) })),
    [releases, today],
  )

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Release</TableHead>
            <TableHead>Status</TableHead>
            {github && <TableHead className="hidden md:table-cell">Code vs Jira</TableHead>}
            <TableHead className="hidden lg:table-cell">Next action</TableHead>
            {showSprint && <TableHead className="hidden md:table-cell">Sprint</TableHead>}
            <TableHead className="hidden sm:table-cell">Owner</TableHead>
            <TableHead>Target</TableHead>
            <TableHead className="hidden sm:table-cell">Progress</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ release: r, summary }) => (
            <TableRow
              key={r.id}
              className="cursor-pointer"
              onMouseEnter={() => prefetch(r.id)}
              onFocus={() => prefetch(r.id)}
              onClick={(e) => {
                // Let modifier-clicks on the link open new tabs.
                if (!(e.target instanceof HTMLElement && e.target.closest('a'))) navigate(`/releases/${r.id}`)
              }}
            >
              <TableCell>
                <Link to={`/releases/${r.id}`} className="font-medium hover:underline focus-visible:underline">
                  {r.name}
                </Link>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{r.version}</span>
              </TableCell>
              <TableCell>
                <ReleaseStatusBadge
                  status={summary.status.status}
                  reasons={summary.status.reasons}
                  overridden={summary.status.overridden}
                />
              </TableCell>
              {github && (
                <TableCell className="hidden md:table-cell">
                  {r.actual_deployment_date && !r.code_check ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <CodeCheckBadge releaseId={r.id} check={r.code_check} />
                  )}
                </TableCell>
              )}
              <TableCell className="hidden max-w-64 lg:table-cell">
                {summary.next ? (
                  <span className="flex items-baseline gap-2">
                    <span className={summary.next.blocked ? 'truncate text-red-600 dark:text-red-400' : 'truncate'}>
                      {summary.next.label}
                    </span>
                    {summary.next.due && <DueDate day={summary.next.due} className="shrink-0 text-xs" />}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              {showSprint && (
                <TableCell className="hidden text-muted-foreground md:table-cell">{r.sprint?.name ?? '—'}</TableCell>
              )}
              <TableCell className="hidden text-muted-foreground sm:table-cell">{r.owner?.name ?? '—'}</TableCell>
              <TableCell className="tabular-nums">
                {r.actual_deployment_date ? (
                  <span className="text-muted-foreground">Deployed {formatDay(r.actual_deployment_date)}</span>
                ) : (
                  formatDay(r.planned_deployment_date)
                )}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <ProgressBar done={summary.done} total={summary.total} label={`${r.name} workflow progress`} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ReleaseTableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-px overflow-hidden rounded-lg border">
      {Array.from({ length: rows + 1 }, (_, i) => (
        <div key={i} className="h-10 animate-pulse bg-muted/50" />
      ))}
    </div>
  )
}
