import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Layers, Plus } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { PageTitle } from '@/components/page-title'
import { QueryError } from '@/components/query-error'
import { SprintStatusBadge } from '@/components/status-badges'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { useSprints } from '@/features/sprints/queries'
import { SprintsDisabled } from '@/features/sprints/sprints-disabled'
import { SprintActions } from '@/features/sprints/sprint-actions'
import { SprintDialog } from '@/features/sprints/sprint-dialog'
import { formatDayRange } from '@/lib/dates'

export default function SprintsPage() {
  const navigate = useNavigate()
  const { currentProject, permissions } = useCurrentProject()
  const sprintsEnabled = !!currentProject?.sprints_enabled
  const { data: sprints, isLoading, error, refetch } = useSprints(currentProject?.id, sprintsEnabled)
  const [creating, setCreating] = useState(false)

  if (currentProject && !sprintsEnabled) {
    return (
      <>
        <PageTitle title="Sprints" />
        <PageHeader title="Sprints" />
        <SprintsDisabled />
      </>
    )
  }

  return (
    <>
      <PageTitle title="Sprints" />
      <PageHeader
        title="Sprints"
        actions={
          permissions.canEdit && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              New sprint
            </Button>
          )
        }
      />

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : !sprints?.length ? (
        <EmptyState
          icon={Layers}
          title="No sprints yet"
          description="Create a sprint to start planning releases."
          action={
            permissions.canEdit && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                New sprint
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sprint</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Releases</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sprints.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    if (!(e.target instanceof HTMLElement && e.target.closest('a,button,[role=menu]'))) {
                      navigate(`/sprints/${s.id}`)
                    }
                  }}
                >
                  <TableCell>
                    <Link to={`/sprints/${s.id}`} className="font-medium hover:underline focus-visible:underline">
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDayRange(s.start_date, s.end_date)}
                  </TableCell>
                  <TableCell>
                    <SprintStatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.release_count}</TableCell>
                  <TableCell>
                    <SprintActions sprint={s} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SprintDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
