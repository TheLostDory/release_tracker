import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { Layers, Plus, Rocket } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { PageTitle } from '@/components/page-title'
import { QueryError } from '@/components/query-error'
import { SprintStatusBadge } from '@/components/status-badges'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SprintSchedule } from '@/features/calendar/sprint-schedule'
import { useOpenCreateRelease } from '@/features/releases/create-release-context'
import { useReleases } from '@/features/releases/queries'
import { summarizeRelease } from '@/features/releases/release-summary'
import { ReleaseTable, ReleaseTableSkeleton } from '@/features/releases/release-table'
import { useSprints } from '@/features/sprints/queries'
import { SprintActions } from '@/features/sprints/sprint-actions'
import { useToday } from '@/hooks/use-today'
import { formatDayRange, parseDay } from '@/lib/dates'
import { RELEASE_STATUS_LABELS } from '@/lib/status-labels'
import type { ReleaseStatus } from '@/types/domain'

export default function SprintDetailPage() {
  const { sprintId = '' } = useParams()
  const { data: sprints, isLoading } = useSprints()
  const sprint = sprints?.find((s) => s.id === sprintId)
  const openCreateRelease = useOpenCreateRelease()
  const releases = useReleases({ sprintId }, { enabled: !!sprint })
  const today = useToday()
  const overview = useMemo(() => {
    if (!releases.data) return null
    let done = 0
    let total = 0
    const byStatus = new Map<ReleaseStatus, number>()
    for (const r of releases.data) {
      const s = summarizeRelease(r, parseDay(today))
      done += s.done
      total += s.total
      byStatus.set(s.status.status, (byStatus.get(s.status.status) ?? 0) + 1)
    }
    return { done, total, byStatus }
  }, [releases.data, today])

  if (isLoading) return <Skeleton className="h-48 w-full" />
  if (!sprint) {
    return (
      <EmptyState
        icon={Layers}
        title="Sprint not found"
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/sprints">All sprints</Link>
          </Button>
        }
      />
    )
  }

  return (
    <>
      <PageTitle title={sprint.name} />
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {sprint.name}
            <SprintStatusBadge status={sprint.status} />
          </span>
        }
        description={
          <>
            {formatDayRange(sprint.start_date, sprint.end_date)}
            {overview && overview.total > 0 && (
              <>
                {' · '}
                {sprint.release_count} release{sprint.release_count === 1 ? '' : 's'}
                {' · '}
                {overview.done}/{overview.total} steps done ({Math.round((overview.done / overview.total) * 100)}%)
                {[...overview.byStatus].map(([status, n]) => ` · ${n} ${RELEASE_STATUS_LABELS[status].toLowerCase()}`)}
              </>
            )}
          </>
        }
        actions={
          <>
            <Button size="sm" onClick={() => openCreateRelease({ sprintId: sprint.id })}>
              <Plus />
              New release
            </Button>
            <SprintActions sprint={sprint} afterDelete="/sprints" />
          </>
        }
      />

      {releases.isLoading ? (
        <ReleaseTableSkeleton />
      ) : releases.error ? (
        <QueryError error={releases.error} onRetry={() => void releases.refetch()} />
      ) : !releases.data?.length ? (
        <EmptyState
          icon={Rocket}
          title="No releases in this sprint"
          action={
            <Button size="sm" onClick={() => openCreateRelease({ sprintId: sprint.id })}>
              <Plus />
              New release
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <SprintSchedule sprint={sprint} releases={releases.data} />
          <section aria-labelledby="sprint-releases-heading">
            <h2 id="sprint-releases-heading" className="mb-2 text-sm font-medium text-muted-foreground">
              Releases
            </h2>
            <ReleaseTable releases={releases.data} />
          </section>
        </div>
      )}
    </>
  )
}
