import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { Layers, Plus, Rocket } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { QueryError } from '@/components/query-error'
import { PageTitle } from '@/components/page-title'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ActionRequired } from '@/features/dashboard/action-required'
import { ReleaseCard } from '@/features/dashboard/release-card'
import { ProjectOverview } from '@/features/dashboard/project-overview'
import { SprintOverview } from '@/features/dashboard/sprint-overview'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { StatusTiles } from '@/features/dashboard/status-tiles'
import { useOpenCreateRelease } from '@/features/releases/create-release-context'
import { useReleases } from '@/features/releases/queries'
import { summarizeRelease } from '@/features/releases/release-summary'
import { useCurrentSprint } from '@/features/sprints/current-sprint-context'
import { useToday } from '@/hooks/use-today'
import { daysFromToday, parseDay } from '@/lib/dates'
import { RELEASE_STATUS_LABELS } from '@/lib/status-labels'
import type { ReleaseStatus } from '@/types/domain'

const STATUSES = Object.keys(RELEASE_STATUS_LABELS) as ReleaseStatus[]
/** Sprint-less projects show releases deployed within this many days. */
const RECENT_DAYS = 14

function isReleaseStatus(value: string | null): value is ReleaseStatus {
  return value !== null && (STATUSES as string[]).includes(value)
}

export default function DashboardPage() {
  const { currentProject, permissions, isLoading: projectsLoading } = useCurrentProject()
  const sprintsEnabled = !!currentProject?.sprints_enabled
  const { currentSprint, isLoading: sprintsLoading } = useCurrentSprint()
  const openCreateRelease = useOpenCreateRelease()
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const statusParam = params.get('status')
  const statusFilter = isReleaseStatus(statusParam) ? statusParam : null

  // Sprints on: the current sprint. Sprints off: the whole project.
  const releases = useReleases(
    sprintsEnabled ? { projectId: currentProject?.id, sprintId: currentSprint?.id } : { projectId: currentProject?.id },
    { enabled: sprintsEnabled ? !!currentSprint : !!currentProject },
  )
  const sprintId = sprintsEnabled ? currentSprint?.id : undefined
  const newRelease = permissions.canEdit ? () => openCreateRelease({ sprintId }) : undefined

  const rows = useMemo(() => {
    const data = releases.data ?? []
    // Without sprints, focus on what's open plus anything deployed recently.
    const scoped = sprintsEnabled
      ? data
      : data.filter((r) => !r.actual_deployment_date || daysFromToday(r.actual_deployment_date, parseDay(today)) >= -RECENT_DAYS)
    return scoped.map((r) => ({ release: r, summary: summarizeRelease(r, parseDay(today)) }))
  }, [releases.data, today, sprintsEnabled])
  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ReleaseStatus, number>
    for (const { summary } of rows) c[summary.status.status]++
    return c
  }, [rows])
  const visible = statusFilter ? rows.filter((r) => r.summary.status.status === statusFilter) : rows

  function setStatusFilter(status: ReleaseStatus | null) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (status) next.set('status', status)
        else next.delete('status')
        return next
      },
      { replace: true },
    )
  }

  if (projectsLoading || sprintsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!currentProject) return null // Layout shows the "no projects" screen.
  if (sprintsEnabled && !currentSprint) {
    return <EmptyState icon={Layers} title="No sprints yet" description="Create a sprint to start tracking releases." />
  }
  const newReleaseButton = newRelease && (
    <Button size="sm" onClick={newRelease}>
      <Plus />
      New release
    </Button>
  )

  return (
    <div className="space-y-5">
      <PageTitle title={`Dashboard · ${currentSprint?.name ?? currentProject.name}`} />
      {currentSprint ? (
        <SprintOverview sprint={currentSprint} today={today} actions={newReleaseButton} />
      ) : (
        <ProjectOverview project={currentProject} recentDays={RECENT_DAYS} actions={newReleaseButton} />
      )}

      {releases.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <StatusTiles counts={counts} total={rows.length} selected={statusFilter} onSelect={setStatusFilter} />
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="releases-heading" className="min-w-0">
          <h2 id="releases-heading" className="mb-2 text-sm font-medium text-muted-foreground">
            {statusFilter ? `${RELEASE_STATUS_LABELS[statusFilter]} releases` : 'Releases'}
          </h2>
          {releases.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-52" />
              ))}
            </div>
          ) : releases.error ? (
            <QueryError error={releases.error} onRetry={() => void releases.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Rocket}
              title={currentSprint ? 'No releases in this sprint' : 'No open releases'}
              action={newReleaseButton}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Rocket}
              title={`No ${RELEASE_STATUS_LABELS[statusFilter!].toLowerCase()} releases`}
              action={
                <Button size="sm" variant="outline" onClick={() => setStatusFilter(null)}>
                  Show all
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map(({ release, summary }) => (
                <ReleaseCard key={release.id} release={release} summary={summary} />
              ))}
            </div>
          )}
        </section>

        <aside className="xl:pt-7">
          <ActionRequired projectId={currentProject.id} />
        </aside>
      </div>
    </div>
  )
}
