import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { QueryError } from '@/components/query-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { useCurrentSprint } from '@/features/sprints/current-sprint-context'
import { formatDay } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { useImportJiraVersions, useJiraVersions } from './queries'

const NO_SPRINT = '__none'

export function ImportJiraDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">{open && <ImportJiraBody onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function ImportJiraBody({ onDone }: { onDone: () => void }) {
  const { currentProject } = useCurrentProject()
  const { sprints, currentSprint } = useCurrentSprint()
  const projectId = currentProject?.id ?? ''
  const { data: versions, isLoading, error, refetch } = useJiraVersions(projectId)
  const importer = useImportJiraVersions(projectId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showReleased, setShowReleased] = useState(false)
  const [sprintId, setSprintId] = useState<string>(currentSprint?.id ?? NO_SPRINT)

  // Unreleased first (soonest release date), archived hidden.
  const visible = useMemo(
    () =>
      (versions ?? [])
        .filter((v) => !v.archived && (showReleased || !v.released))
        .sort((a, b) => Number(a.released) - Number(b.released) || (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999')),
    [versions, showReleased],
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onImport() {
    try {
      const { created } = await importer.mutateAsync({
        versionIds: [...selected],
        sprintId: currentProject?.sprints_enabled && sprintId !== NO_SPRINT ? sprintId : null,
      })
      toast.success(`${created.length} release${created.length === 1 ? '' : 's'} imported from Jira`)
      onDone()
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <DialogHeader>
        <DialogTitle>Import from Jira</DialogTitle>
        <DialogDescription>
          Each Jira version becomes a release (name and version from Jira, target date from its release date or two weeks
          from today). Its tasks and bugs then show on the release page.
        </DialogDescription>
      </DialogHeader>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No {showReleased ? '' : 'unreleased '}versions in Jira.</p>
      ) : (
        <ul className="max-h-72 divide-y overflow-x-hidden overflow-y-auto rounded-md border">
          {visible.map((v) => (
            <li key={v.id}>
              <label className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-foreground"
                  disabled={!!v.release}
                  checked={!!v.release || selected.has(v.id)}
                  onChange={() => toggle(v.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium break-words">{v.name}</span>
                  {v.released && <span className="ml-2 text-xs text-muted-foreground">released</span>}
                  {v.description && (
                    <span className="block truncate text-xs text-muted-foreground" title={v.description}>
                      {v.description}
                    </span>
                  )}
                </span>
                {v.release ? (
                  <Link
                    to={`/releases/${v.release.id}`}
                    onClick={onDone}
                    title={`Imported as ${v.release.name}`}
                    className="max-w-[40%] shrink-0 truncate text-right text-xs text-muted-foreground hover:underline"
                  >
                    Imported as {v.release.name}
                  </Link>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{v.releaseDate ? formatDay(v.releaseDate) : 'no date'}</span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="size-3.5 accent-foreground" checked={showReleased} onChange={(e) => setShowReleased(e.target.checked)} />
          Show released versions
        </label>
        {currentProject?.sprints_enabled && (
          <Select value={sprintId} onValueChange={setSprintId}>
            <SelectTrigger size="sm" className="w-44" aria-label="Sprint for imported releases">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SPRINT}>No sprint</SelectItem>
              {sprints.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={importer.isPending}>
          Cancel
        </Button>
        <Button onClick={() => void onImport()} disabled={selected.size === 0 || importer.isPending}>
          {importer.isPending ? 'Importing…' : `Import ${selected.size || ''}`}
        </Button>
      </DialogFooter>
    </div>
  )
}
