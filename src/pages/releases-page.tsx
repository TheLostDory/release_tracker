import { useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Download, Plus, Rocket, Search } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { PageTitle } from '@/components/page-title'
import { QueryError } from '@/components/query-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RELEASE_LIST_LIMIT, type ReleaseListItem } from '@/features/releases/api'
import { useOpenCreateRelease } from '@/features/releases/create-release-context'
import { useReleases } from '@/features/releases/queries'
import { ReleaseTable, ReleaseTableSkeleton } from '@/features/releases/release-table'
import { ImportJiraDialog } from '@/features/integrations/import-jira-dialog'
import { useConnected } from '@/features/integrations/queries'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { useCurrentSprint } from '@/features/sprints/current-sprint-context'

const ALL = 'all'
const NONE = 'none'

function matches(r: ReleaseListItem, q: string): boolean {
  return [r.name, r.version, r.sprint?.name ?? '', r.owner?.name ?? ''].some((v) => v.toLowerCase().includes(q))
}

export default function ReleasesPage() {
  const [params, setParams] = useSearchParams()
  const { currentProject, permissions } = useCurrentProject()
  const { sprints, currentSprint } = useCurrentSprint()
  const openCreateRelease = useOpenCreateRelease()
  const sprintsEnabled = !!currentProject?.sprints_enabled

  // Filters live in the URL so views can be shared and survive reloads.
  const sprintParam = sprintsEnabled ? (params.get('sprint') ?? currentSprint?.id ?? ALL) : ALL
  const sprintId = sprintParam === ALL ? undefined : sprintParam
  const q = params.get('q') ?? ''
  const deferredQ = useDeferredValue(q.trim().toLowerCase())

  const { data, isLoading, error, refetch } = useReleases(
    { projectId: currentProject?.id, sprintId },
    { enabled: !!currentProject },
  )
  const { jira } = useConnected(currentProject?.id)
  const [importing, setImporting] = useState(false)
  const newRelease = permissions.canEdit
    ? () => openCreateRelease({ sprintId: sprintId && sprintId !== NONE ? sprintId : undefined })
    : undefined
  const filtered = useMemo(() => (deferredQ ? data?.filter((r) => matches(r, deferredQ)) : data), [data, deferredQ])

  function setParam(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  return (
    <>
      <PageTitle title="Releases" />
      <PageHeader
        title="Releases"
        actions={
          newRelease && (
            <>
              {jira && (
                <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
                  <Download />
                  Import from Jira
                </Button>
              )}
              <Button size="sm" onClick={newRelease}>
                <Plus />
                New release
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {sprintsEnabled && (
        <Select value={sprintParam} onValueChange={(v) => setParam('sprint', v)}>
          <SelectTrigger size="sm" className="w-auto max-w-full min-w-44" aria-label="Filter by sprint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sprints</SelectItem>
            <SelectItem value={NONE}>No sprint</SelectItem>
            {sprints.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        )}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Filter by name, version, owner…"
            aria-label="Filter releases"
            className="h-7 pl-8 text-sm"
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </div>
        {data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered?.length ?? 0} of {data.length}
            {data.length >= RELEASE_LIST_LIMIT && ` (showing the latest ${RELEASE_LIST_LIMIT}; pick a sprint to narrow)`}
          </span>
        )}
      </div>

      {isLoading ? (
        <ReleaseTableSkeleton rows={5} />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={Rocket}
          title="No releases"
          description={sprintId ? 'No releases match this sprint filter.' : 'Create the first release to get started.'}
          action={
            newRelease && (
              <Button size="sm" onClick={newRelease}>
                <Plus />
                New release
              </Button>
            )
          }
        />
      ) : !filtered?.length ? (
        <EmptyState icon={Search} title="No matches" description={`Nothing matches “${q}”.`} />
      ) : (
        <ReleaseTable releases={filtered} showSprint={sprintsEnabled && !sprintId} />
      )}
      <ImportJiraDialog open={importing} onOpenChange={setImporting} />
    </>
  )
}
