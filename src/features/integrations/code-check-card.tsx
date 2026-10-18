import { useEffect } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CircleCheck, GitCompareArrows, GitPullRequest, ListTodo, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ReleaseDetail } from '@/features/releases/api'
import { releaseKeys } from '@/features/releases/queries'
import { formatTimestamp } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getCodeComparison, type CodeComparison } from './api'
import type { ComparisonTab } from './code-comparison'
import { integrationKeys, useCodeComparison, useCodeRefs, useConnected } from './queries'

/** Header button on every release (when GitHub is connected): opens the comparison. */
export function CodeCompareButton({ releaseId, projectId }: { releaseId: string; projectId: string }) {
  const { github } = useConnected(projectId)
  if (!github) return null
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={`/releases/${releaseId}/compare`}>
        <GitCompareArrows />
        Code vs Jira
      </Link>
    </Button>
  )
}

/**
 * The result at a glance, for releases where the comparison is set up (it's
 * optional: nothing shows until someone chooses the branches).
 */
export function CodeCheckCard({ release }: { release: ReleaseDetail }) {
  const { github } = useConnected(release.project_id)
  const refs = useCodeRefs(release.id)
  const configured = !!github && !!refs.data?.connected && refs.data.refs.length > 0
  const comparison = useCodeComparison(release.id, configured)
  if (!configured) return null
  const compareUrl = `/releases/${release.id}/compare`

  return (
    <section aria-labelledby="code-check-heading" className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="code-check-heading" className="flex items-center gap-2 text-sm font-semibold">
          <GitCompareArrows className="size-4 text-muted-foreground" aria-hidden />
          Code vs Jira
          {comparison.data && <Verdict data={comparison.data} />}
        </h2>
        <div className="flex items-center gap-2">
          {comparison.data && <RefreshButton releaseId={release.id} busy={comparison.isFetching} />}
          <Button asChild size="sm" variant={comparison.data && differences(comparison.data) > 0 ? 'default' : 'outline'}>
            <Link to={compareUrl}>
              Open comparison <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-3">
        {comparison.isLoading ? (
          <p className="text-sm text-muted-foreground">Reading the RC from GitHub and the version from Jira…</p>
        ) : comparison.error ? (
          <p className="text-sm text-destructive">
            {toUserMessage(comparison.error)}{' '}
            <button type="button" className="underline" onClick={() => void comparison.refetch()}>
              Try again
            </button>
          </p>
        ) : comparison.data ? (
          <Results data={comparison.data} compareUrl={compareUrl} />
        ) : null}
      </div>
    </section>
  )
}

const differences = (d: CodeComparison) => d.jiraOnly.length + d.codeOnly.length + d.noKey.length

function Verdict({ data }: { data: CodeComparison }) {
  const n = differences(data)
  return n === 0 ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-normal text-emerald-700 dark:text-emerald-400">
      <CircleCheck className="size-3.5" aria-hidden /> Matches
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-normal text-amber-800 dark:text-amber-300">
      <TriangleAlert className="size-3.5" aria-hidden /> {n} difference{n === 1 ? '' : 's'}
    </span>
  )
}

function Results({ data, compareUrl }: { data: CodeComparison; compareUrl: string }) {
  // A new result changes the releases list badge and the dashboard.
  const qc = useQueryClient()
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: releaseKeys.lists() })
  }, [data.comparedAt, qc])

  const doneNotMerged = data.jiraOnly.filter((i) => i.statusCategory === 'done').length
  const tiles: { tab: ComparisonTab; count: number; label: string; hint?: string; icon: LucideIcon; good?: boolean }[] = [
    {
      tab: 'jiraOnly',
      count: data.jiraOnly.length,
      label: 'In Jira, not merged',
      hint: doneNotMerged ? `${doneNotMerged} marked Done` : undefined,
      icon: ListTodo,
    },
    { tab: 'codeOnly', count: data.codeOnly.length, label: 'Merged, not in this version', icon: GitPullRequest },
    { tab: 'noKey', count: data.noKey.length, label: 'Merged without an issue', icon: GitPullRequest },
    { tab: 'matched', count: data.matched.length, label: 'In both', icon: CircleCheck, good: true },
  ]
  const repos = data.repos
  return (
    <div className="space-y-3">
      {data.notes.length > 0 && <p className="text-sm text-amber-800 dark:text-amber-300">{data.notes[0]}</p>}
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const flagged = !t.good && t.count > 0
          const Icon = flagged ? TriangleAlert : t.good || t.count === 0 ? CircleCheck : t.icon
          return (
            <li key={t.tab}>
              <Link
                to={`${compareUrl}?tab=${t.tab}`}
                className={cn(
                  'flex h-full flex-col gap-1 rounded-md border p-3 hover:bg-muted/50',
                  flagged && 'border-amber-500/50 bg-amber-500/5',
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon
                    className={cn(
                      'size-3.5 shrink-0',
                      flagged ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400',
                    )}
                    aria-hidden
                  />
                  {t.label}
                </span>
                <span className="text-2xl font-semibold tabular-nums">{t.count}</span>
                {t.hint && <span className="text-xs text-muted-foreground">{t.hint}</span>}
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {repos.map((r) => `${r.repo} ${r.baseRef} … ${r.headRef}`).join(' · ')} ·{' '}
        {repos.reduce((n, r) => n + r.totalCommits, 0)} commits · checked {formatTimestamp(data.comparedAt)}
      </p>
    </div>
  )
}

function RefreshButton({ releaseId, busy }: { releaseId: string; busy: boolean }) {
  const qc = useQueryClient()
  async function refresh() {
    try {
      qc.setQueryData(integrationKeys.codeComparison(releaseId), await getCodeComparison(releaseId, true))
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }
  return (
    <Button size="icon-sm" variant="ghost" aria-label="Check again" title="Check again" disabled={busy} onClick={() => void refresh()}>
      <RefreshCw className={cn(busy && 'animate-spin')} />
    </Button>
  )
}
