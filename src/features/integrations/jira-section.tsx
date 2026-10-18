import { useMemo, useState } from 'react'
import { ExternalLink, RefreshCw, Unlink } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { QueryError } from '@/components/query-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ReleaseDetail } from '@/features/releases/api'
import { toUserMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getJiraIssues } from './api'
import { CATEGORY } from './jira-status'
import { integrationKeys, useConnected, useJiraIssues, useJiraVersions, useLinkJiraVersion } from './queries'

export function JiraSection({ release, canEdit }: { release: ReleaseDetail; canEdit: boolean }) {
  const { jira } = useConnected(release.project_id)
  if (!jira) return null
  return (
    <section aria-labelledby="jira-heading" className="space-y-2">
      <h2 id="jira-heading" className="text-sm font-medium text-muted-foreground">
        Jira
      </h2>
      {release.jira_version_id ? (
        <LinkedVersion release={release} canEdit={canEdit} />
      ) : (
        <LinkVersion release={release} canEdit={canEdit} />
      )}
    </section>
  )
}

function LinkVersion({ release, canEdit }: { release: ReleaseDetail; canEdit: boolean }) {
  const { data: versions, isLoading, error } = useJiraVersions(release.project_id, canEdit)
  const link = useLinkJiraVersion(release.id, release.project_id)
  const [versionId, setVersionId] = useState<string>()
  const available = (versions ?? []).filter((v) => !v.release && !v.archived)

  if (!canEdit) {
    return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Not linked to a Jira version.</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
      <span className="text-sm text-muted-foreground">Link this release to a Jira version to see its tasks and bugs.</span>
      {isLoading ? (
        <Skeleton className="h-8 w-48" />
      ) : error ? (
        <span className="text-sm text-destructive">{toUserMessage(error)}</span>
      ) : (
        <>
          <Select value={versionId} onValueChange={setVersionId}>
            <SelectTrigger size="sm" className="w-48" aria-label="Jira version">
              <SelectValue placeholder="Choose a version" />
            </SelectTrigger>
            <SelectContent>
              {available.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                  {v.released ? ' (released)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!versionId || link.isPending}
            onClick={() =>
              link.mutate(versionId!, {
                onSuccess: () => toast.success('Linked to Jira'),
                onError: (err) => toast.error(toUserMessage(err)),
              })
            }
          >
            Link
          </Button>
        </>
      )}
    </div>
  )
}

function LinkedVersion({ release, canEdit }: { release: ReleaseDetail; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useJiraIssues(release.id, true)
  const unlink = useLinkJiraVersion(release.id, release.project_id)
  const [type, setType] = useState('ALL')
  const [refreshing, setRefreshing] = useState(false)
  const issues = useMemo(() => (data?.linked ? data.issues : []), [data])
  const types = useMemo(() => [...new Set(issues.map((i) => i.type))].sort(), [issues])
  const visible = type === 'ALL' ? issues : issues.filter((i) => i.type === type)
  const counts = useMemo(() => {
    const c = { new: 0, indeterminate: 0, done: 0, unknown: 0 }
    for (const i of issues) c[i.statusCategory]++
    return c
  }, [issues])

  async function refresh() {
    setRefreshing(true)
    try {
      qc.setQueryData(integrationKeys.jiraIssues(release.id), await getJiraIssues(release.id, true))
    } catch (err) {
      toast.error(toUserMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <span className="text-sm font-medium">Version {release.jira_version_name}</span>
        {data?.linked && (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              {issues.length} issues · {counts.done} done · {counts.indeterminate} in progress · {counts.new} to do
            </span>
            <a href={data.versionUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline">
              Open in Jira <ExternalLink className="inline size-3" aria-hidden />
            </a>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {types.length > 1 && (
            <Select value={type} onValueChange={setType}>
              <SelectTrigger size="sm" className="h-7 w-32 text-xs" aria-label="Filter by issue type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="icon-sm" variant="ghost" aria-label="Refresh from Jira" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
          {canEdit && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Unlink Jira version"
              onClick={() =>
                unlink.mutate(null, {
                  onSuccess: () => toast.success('Unlinked from Jira'),
                  onError: (err) => toast.error(toUserMessage(err)),
                })
              }
            >
              <Unlink />
            </Button>
          )}
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="m-3 h-24" />
      ) : error ? (
        <div className="p-3">
          <QueryError error={error} onRetry={() => void refetch()} />
        </div>
      ) : visible.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No issues in this version.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Key</TableHead>
                <TableHead className="hidden w-20 sm:table-cell">Type</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="hidden w-24 md:table-cell">Priority</TableHead>
                <TableHead className="hidden w-32 lg:table-cell">Assignee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((i) => (
                <TableRow key={i.key}>
                  <TableCell>
                    <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:underline">
                      {i.key}
                    </a>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{i.type}</TableCell>
                  <TableCell className="max-w-0 truncate" title={i.summary}>
                    {i.summary}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('font-normal', CATEGORY[i.statusCategory].className)} title={CATEGORY[i.statusCategory].label}>
                      {i.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{i.priority ?? '—'}</TableCell>
                  <TableCell className="hidden truncate text-xs text-muted-foreground lg:table-cell">{i.assignee ?? 'Unassigned'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data?.linked && data.truncated && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the first 1,000 issues. Open the version in Jira for all.</p>
          )}
        </div>
      )}
    </div>
  )
}
