import { useState, type FormEvent } from 'react'
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestamp } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { safeHttpUrl } from '@/lib/safe-url'
import { cn } from '@/lib/utils'
import type { BuildNode, FollowedBuild } from './api'
import { buildProgress, formatDuration, summarizeDownstream, summaryText } from './followed-builds'
import { BuildResultBadge } from './build-result-badge'
import { isActive, useFollowBuild, useFollowedBuilds, useFollowedBuildStatus, useUnfollowBuild } from './queries'

/** Builds pasted by link, with the live status of everything each one started. */
export function FollowedBuilds({ releaseId, canEdit }: { releaseId: string; canEdit: boolean }) {
  const { data: followed = [], isLoading } = useFollowedBuilds(releaseId, true)
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">Followed builds</h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
            <Plus />
            Follow a build
          </Button>
        )}
      </div>
      {adding && <FollowForm releaseId={releaseId} onDone={() => setAdding(false)} />}
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : followed.length === 0 ? (
        !adding && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No followed builds.{canEdit && ' Paste the link of a running Jenkins build to see its status and the status of every job it starts.'}
          </p>
        )
      ) : (
        <ul className="space-y-2">
          {followed.map((f) => (
            <FollowedCard key={f.id} followed={f} releaseId={releaseId} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  )
}

function FollowForm({ releaseId, onDone }: { releaseId: string; onDone: () => void }) {
  const follow = useFollowBuild(releaseId)
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await follow.mutateAsync({ url: url.trim(), label: label.trim() || null })
      toast.success('Following the build')
      onDone()
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_12rem_auto]">
      <Input
        autoFocus
        required
        type="url"
        aria-label="Jenkins build link"
        placeholder="https://jenkins…/job/release/job/pipeline/42/"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <Input aria-label="Label (optional)" placeholder="Label (optional)" maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="h-9" disabled={follow.isPending || !url.trim()}>
          {follow.isPending ? 'Reading build…' : 'Follow'}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-9" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-3">
        Paste a build link (or a job link to follow its latest run). Classic and Blue Ocean links both work.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {error}
        </p>
      )}
    </form>
  )
}

function FollowedCard({ followed, releaseId, canEdit }: { followed: FollowedBuild; releaseId: string; canEdit: boolean }) {
  const { data = followed, isFetching, refetch, dataUpdatedAt } = useFollowedBuildStatus(followed)
  // Progress is as of the last answer from Jenkins (refreshed every 15 s while running).
  const now = dataUpdatedAt || Date.parse(followed.last_synced_at ?? followed.created_at)
  const unfollow = useUnfollowBuild(releaseId)
  const [removing, setRemoving] = useState(false)
  const root = data.status
  const summary = root ? summaryText(summarizeDownstream(root)) : ''
  const title = data.label || `${data.job_path} #${data.build_number}`

  return (
    <li className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 truncate font-medium" title={title}>
          {title}
        </span>
        {root && <StatusBadge node={root} />}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Refresh ${title}`}
          title={data.last_synced_at ? `Checked ${formatTimestamp(data.last_synced_at)}` : undefined}
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCw className={cn(isFetching && 'animate-spin')} />
        </Button>
        {canEdit && (
          <Button size="icon-sm" variant="ghost" aria-label={`Stop following ${title}`} onClick={() => setRemoving(true)}>
            <Trash2 />
          </Button>
        )}
      </div>
      {root && <BuildRow node={root} now={now} showBadge={false} />}
      {root && <Progress node={root} now={now} />}
      {summary && <p className="mt-1 text-xs text-muted-foreground">{summary}</p>}
      {data.last_error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">Couldn’t refresh: {data.last_error} Showing the last known status.</p>
      )}
      {root && root.children.length > 0 && (
        <div className="mt-2">
          <BuildTree nodes={root.children} now={now} />
        </div>
      )}
      {root && isActive(root) && <p className="mt-2 text-xs text-muted-foreground">Updates every 15 seconds while builds are running.</p>}
      <ConfirmDeleteDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Stop following ${title}?`}
        description="Only removes it from this release; nothing changes in Jenkins."
        confirmLabel="Stop following"
        pending={unfollow.isPending}
        onConfirm={() =>
          unfollow.mutate(followed.id, {
            onSuccess: () => setRemoving(false),
            onError: (err) => toast.error(toUserMessage(err)),
          })
        }
      />
    </li>
  )
}

function StatusBadge({ node }: { node: BuildNode }) {
  if (node.queued) return <Badge variant="secondary" className="font-normal">Queued</Badge>
  return <BuildResultBadge build={node} />
}

function Progress({ node, now }: { node: BuildNode; now: number }) {
  const pct = buildProgress(node, now)
  if (pct === null) return null
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Estimated progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  )
}

function BuildTree({ nodes, now }: { nodes: BuildNode[]; now: number }) {
  return (
    <ul className="ml-1 border-l pl-3">
      {nodes.map((n) => (
        <li key={`${n.jobPath}#${n.number ?? 'queued'}`}>
          <BuildRow node={n} now={now} />
          {n.children.length > 0 && <BuildTree nodes={n.children} now={now} />}
        </li>
      ))}
    </ul>
  )
}

function BuildRow({ node, now, showBadge = true }: { node: BuildNode; now: number; showBadge?: boolean }) {
  const href = safeHttpUrl(node.url)
  const pct = buildProgress(node, now)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-xs">
      {showBadge && <StatusBadge node={node} />}
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-mono hover:underline">
          {node.name} <ExternalLink className="inline size-3" aria-hidden />
        </a>
      ) : (
        <span className="min-w-0 truncate font-mono">{node.name}</span>
      )}
      <span className="text-muted-foreground tabular-nums">
        {node.timestamp ? formatTimestamp(new Date(node.timestamp).toISOString()) : ''}
        {!node.building && node.duration ? ` · ${formatDuration(node.duration)}` : ''}
        {pct !== null ? ` · ~${pct}%` : ''}
      </span>
      {node.error && <span className="text-red-600 dark:text-red-400">{node.error}</span>}
    </div>
  )
}
