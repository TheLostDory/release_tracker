import { useEffect, useMemo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowRight, Rocket } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { QueryError } from '@/components/query-error'
import { PageTitle } from '@/components/page-title'
import { ReleaseStatusBadge } from '@/components/status-badges'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CodeCheckCard } from '@/features/integrations/code-check-card'
import { JenkinsSection } from '@/features/integrations/jenkins-section'
import { JiraSection } from '@/features/integrations/jira-section'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { DueDate } from '@/features/releases/due-date'
import {
  useRelease,
  useReleaseRealtime,
  useUpdateApproval,
  useUpdateReport,
  useUpdateTask,
} from '@/features/releases/queries'
import { ReleaseActions } from '@/features/releases/release-actions'
import { summarizeRelease } from '@/features/releases/release-summary'
import { ActivityFeed } from '@/features/releases/workflow/activity-feed'
import { ApprovalCard } from '@/features/releases/workflow/approval-card'
import { useDependencyGuard } from '@/features/releases/workflow/dependency-guard'
import { ReportCards } from '@/features/releases/workflow/report-cards'
import { TaskList } from '@/features/releases/workflow/task-list'
import { WorkflowTimeline } from '@/features/releases/workflow/workflow-timeline'
import { useToday } from '@/hooks/use-today'
import { formatDay, formatTimestamp, parseDay } from '@/lib/dates'
import { permissionsFor } from '@/lib/permissions'
import { isNotFound } from '@/lib/errors'
import { cn } from '@/lib/utils'

export default function ReleaseDetailPage() {
  const { releaseId = '' } = useParams()
  const { data: release, isLoading, error, refetch } = useRelease(releaseId)
  useReleaseRealtime(release ? releaseId : undefined)
  const updateTask = useUpdateTask(releaseId)
  const updateReport = useUpdateReport(releaseId)
  const updateApproval = useUpdateApproval(releaseId)
  const [guard, guardDialog] = useDependencyGuard()
  const today = useToday()
  const summary = useMemo(() => (release ? summarizeRelease(release, parseDay(today)) : null), [release, today])
  const { projects, currentProject, setCurrentProjectId } = useCurrentProject()
  // Opening a release from another project (link, search, notification)
  // switches the app to that project so navigation and context match.
  const releaseProjectId = release?.project_id
  useEffect(() => {
    if (releaseProjectId && releaseProjectId !== currentProject?.id) setCurrentProjectId(releaseProjectId)
  }, [releaseProjectId, currentProject?.id, setCurrentProjectId])
  const project = projects.find((p) => p.id === releaseProjectId)
  const permissions = permissionsFor(project?.role)
  const readOnly = !permissions.canEdit

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }
  // 404 (missing or not visible) and 400 (malformed id) both mean "not found".
  if (error && !isNotFound(error)) {
    return <QueryError error={error} onRetry={() => void refetch()} />
  }
  if (!release || !summary) {
    return (
      <EmptyState
        icon={Rocket}
        title="Release not found"
        description="It may have been deleted."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/releases">All releases</Link>
          </Button>
        }
      />
    )
  }

  const { status, next } = summary

  return (
    <div className="space-y-6">
      <PageTitle title={`${release.name} ${release.version}`} />
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{release.name}</h1>
              <span className="font-mono text-sm text-muted-foreground">{release.version}</span>
              <ReleaseStatusBadge status={status.status} overridden={status.overridden} />
            </div>
            {release.description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{release.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {readOnly ? (
              <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">View only</span>
            ) : (
              <ReleaseActions release={release} canDelete={permissions.canDelete} />
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <Meta label={release.sprint ? 'Project · Sprint' : 'Project'}>
            <span className="truncate">{project?.name ?? '—'}</span>
            {release.sprint && (
              <>
                <span className="text-muted-foreground"> · </span>
                <Link to={`/sprints/${release.sprint.id}`} className="hover:underline">
                  {release.sprint.name}
                </Link>
              </>
            )}
          </Meta>
          <Meta label="Owner">{release.owner?.name ?? 'Unassigned'}</Meta>
          <Meta label="Target deployment">
            {formatDay(release.planned_deployment_date, 'EEE, MMM d')}
            {!release.actual_deployment_date && (
              <DueDate day={release.planned_deployment_date} className="ml-1.5 text-xs" />
            )}
          </Meta>
          <Meta label={release.actual_deployment_date ? 'Deployed' : 'Created'}>
            {release.actual_deployment_date
              ? formatDay(release.actual_deployment_date, 'EEE, MMM d')
              : formatTimestamp(release.created_at, 'MMM d, yyyy')}
          </Meta>
          <Meta label="Next action" className="col-span-2 sm:col-span-1">
            {next ? (
              <span className={cn('flex items-center gap-1', next.blocked && 'text-red-600 dark:text-red-400')}>
                <ArrowRight className="size-3.5 shrink-0" />
                <span className="truncate">{next.label}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{status.status === 'RELEASED' ? 'Done' : '—'}</span>
            )}
            {next?.due && <DueDate day={next.due} showDate className="block text-xs" />}
          </Meta>
        </dl>

        {status.reasons.length > 0 && (
          <ul
            className={cn(
              'space-y-0.5 rounded-lg border px-4 py-2.5 text-sm',
              status.status === 'BLOCKED'
                ? 'border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-300'
                : 'border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-300',
            )}
          >
            {status.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </header>

      <CodeCheckCard release={release} canEdit={permissions.canEdit} canManage={permissions.canManage} />

      <Section title="Progress">
        <div className="rounded-lg border px-2 pt-4 pb-2">
          <WorkflowTimeline tasks={release.tasks} current={next?.type ?? null} />
        </div>
      </Section>

      <Section title="Workflow steps">
        <TaskList
          tasks={release.tasks}
          current={next?.type ?? null}
          onUpdate={(task, patch) => updateTask.mutate({ task, patch })}
          guard={guard}
          readOnly={readOnly}
          release={{ id: release.id, projectId: release.project_id, reportTypes: release.reports.map((r) => r.report_type) }}
        />
      </Section>

      <Section title="Reports & approval">
        <div className="grid gap-3 xl:grid-cols-4">
          <div className="xl:col-span-3">
            <ReportCards
              reports={release.reports}
              tasks={release.tasks}
              onUpdate={(id, patch) => updateReport.mutate({ id, patch })}
              guard={guard}
              readOnly={readOnly}
            />
          </div>
          {release.approval && (
            <ApprovalCard
              approval={release.approval}
              tasks={release.tasks}
              onUpdate={(id, patch) => updateApproval.mutate({ id, patch })}
              guard={guard}
              readOnly={readOnly}
            />
          )}
        </div>
      </Section>

      <JiraSection release={release} canEdit={!readOnly} />
      <JenkinsSection release={release} canEdit={!readOnly} />

      <Section title="Activity">
        <ActivityFeed releaseId={release.id} />
      </Section>

      {guardDialog}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2 text-sm font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Meta({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
