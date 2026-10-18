import { useDeferredValue, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, GitCompareArrows, GitMerge, GitPullRequest, Info, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/empty-state'
import { PageTitle } from '@/components/page-title'
import { QueryError } from '@/components/query-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getCodeComparison, type CodeChange, type CodeComparison, type CodeRefs, type JiraIssue } from '@/features/integrations/api'
import {
  defaultTab,
  elsewhereLabel,
  filterComparison,
  sortJiraOnly,
  tabCounts,
  TAB_ORDER,
  type ComparisonTab,
} from '@/features/integrations/code-comparison'
import { CATEGORY } from '@/features/integrations/jira-status'
import { integrationKeys, useCodeComparison, useCodeRefs, useSaveCodeRefs } from '@/features/integrations/queries'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { useRelease } from '@/features/releases/queries'
import { formatTimestamp } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { permissionsFor } from '@/lib/permissions'
import { safeHttpUrl } from '@/lib/safe-url'
import { cn } from '@/lib/utils'

const TABS: Record<ComparisonTab, { label: string; hint: string }> = {
  jiraOnly: {
    label: 'In Jira, not merged',
    hint: 'Issues in the Jira version that no merged pull request or commit mentions. Issues marked Done come first. Tasks without code (QA, docs) also show up here.',
  },
  codeOnly: {
    label: 'Merged, not in this version',
    hint: 'Merged changes mention these issues, but they are not in this Jira version: they are planned for another version, have no fix version, or don’t exist.',
  },
  noKey: {
    label: 'Merged without an issue',
    hint: 'Pull requests and branch merges that mention no Jira issue in their title, branch name or message.',
  },
  matched: { label: 'In both', hint: 'Issues in the Jira version with merged changes.' },
}

export default function ReleaseComparePage() {
  const { releaseId = '' } = useParams()
  const { data: release, isLoading, error } = useRelease(releaseId)
  const { projects, currentProject, setCurrentProjectId } = useCurrentProject()
  const projectId = release?.project_id
  useEffect(() => {
    if (projectId && projectId !== currentProject?.id) setCurrentProjectId(projectId)
  }, [projectId, currentProject?.id, setCurrentProjectId])
  const canEdit = permissionsFor(projects.find((p) => p.id === projectId)?.role).canEdit
  const refs = useCodeRefs(releaseId)

  if (isLoading || refs.isLoading) return <Skeleton className="h-64 w-full" />
  if (error || !release) return <QueryError error={error ?? new Error('Release not found.')} />

  return (
    <div className="space-y-6">
      <PageTitle title={`Code vs Jira · ${release.name}`} />
      <header className="space-y-1">
        <Link to={`/releases/${release.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> {release.name} <span className="font-mono">{release.version}</span>
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <GitCompareArrows className="size-5 text-muted-foreground" aria-hidden /> Code vs Jira
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          What was merged into the release candidate, compared with the issues in its Jira version
          {release.jira_version_name ? (
            <>
              {' '}
              <span className="font-medium text-foreground">{release.jira_version_name}</span>
            </>
          ) : null}
          .
        </p>
      </header>

      {refs.error ? (
        <QueryError error={refs.error} onRetry={() => void refs.refetch()} />
      ) : !refs.data?.connected ? (
        <EmptyState
          icon={GitCompareArrows}
          title="GitHub isn’t connected"
          description="An admin can connect GitHub and choose the repositories in Settings → Project → Integrations."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/settings/project">Project settings</Link>
            </Button>
          }
        />
      ) : (
        <Comparison releaseId={release.id} refs={refs.data} canEdit={canEdit} />
      )}
    </div>
  )
}

function Comparison({ releaseId, refs, canEdit }: { releaseId: string; refs: Extract<CodeRefs, { connected: true }>; canEdit: boolean }) {
  const configured = refs.refs.length > 0
  const [editing, setEditing] = useState(false)
  const comparison = useCodeComparison(releaseId, configured && !editing)
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    setRefreshing(true)
    try {
      qc.setQueryData(integrationKeys.codeComparison(releaseId), await getCodeComparison(releaseId, true))
    } catch (err) {
      toast.error(toUserMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  if (!configured || editing) {
    return canEdit ? (
      <RefsForm releaseId={releaseId} refs={refs} onDone={() => setEditing(false)} onCancel={configured ? () => setEditing(false) : undefined} />
    ) : (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No branches chosen for this release yet. A member can choose them.</p>
    )
  }

  return (
    <div className="space-y-4">
      <section aria-label="What is compared" className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm">
        <ul className="min-w-0 space-y-1">
          {(comparison.data?.repos ?? refs.refs.map((r) => ({ repo: r.repo, baseRef: r.base_ref, headRef: r.head_ref, totalCommits: null, compareUrl: '', error: null, truncated: false }))).map((r) => (
            <li key={r.repo} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium">{r.repo}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {r.baseRef} … <span className="text-foreground">{r.headRef}</span>
              </span>
              {r.totalCommits !== null && !r.error && (
                <span className="text-xs text-muted-foreground">
                  {r.totalCommits} commit{r.totalCommits === 1 ? '' : 's'}
                  {r.truncated && ' (first 3000 compared)'}
                </span>
              )}
              {safeHttpUrl(r.compareUrl) && (
                <a href={r.compareUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline">
                  View on GitHub <ExternalLink className="inline size-3" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={refreshing || comparison.isFetching} onClick={() => void refresh()}>
            <RefreshCw className={cn((refreshing || comparison.isFetching) && 'animate-spin')} />
            Refresh
          </Button>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Change branches
            </Button>
          )}
        </div>
      </section>

      {comparison.isLoading ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Reading commits and pull requests from GitHub and issues from Jira…</p>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : comparison.error ? (
        <QueryError error={comparison.error} onRetry={() => void comparison.refetch()} />
      ) : comparison.data ? (
        <Results data={comparison.data} />
      ) : null}
    </div>
  )
}

function RefsForm({
  releaseId,
  refs,
  onDone,
  onCancel,
}: {
  releaseId: string
  refs: Extract<CodeRefs, { connected: true }>
  onDone: () => void
  onCancel?: () => void
}) {
  const save = useSaveCodeRefs(releaseId)
  const [rows, setRows] = useState(() =>
    refs.repos.map((repo) => {
      const saved = refs.refs.find((r) => r.repo === repo)
      const suggested = refs.suggestions.find((s) => s.repo === repo)
      return { repo, baseRef: saved?.base_ref ?? suggested?.baseRef ?? '', headRef: saved?.head_ref ?? suggested?.headRef ?? '' }
    }),
  )
  const [error, setError] = useState<string | null>(null)
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const chosen = rows.filter((r) => r.baseRef.trim() && r.headRef.trim()).map((r) => ({ ...r, baseRef: r.baseRef.trim(), headRef: r.headRef.trim() }))
    if (chosen.length === 0) return setError('Fill in both branches for at least one repository.')
    try {
      await save.mutateAsync(chosen)
      onDone()
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-semibold">What to compare</h2>
        <p className="text-sm text-muted-foreground">
          For each repository: the release candidate (branch or tag), and what it is compared with, usually the previous release’s
          branch or tag{refs.previousRelease ? ` (${refs.previousRelease.name}, ${refs.previousRelease.version})` : ''}. Leave a
          repository empty to skip it.
        </p>
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <fieldset key={r.repo} className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr_1fr] sm:items-end">
            <legend className="sr-only">{r.repo}</legend>
            <span className="truncate pb-2 text-sm font-medium" title={r.repo}>
              {r.repo}
            </span>
            <label className="space-y-1 text-xs text-muted-foreground">
              Compared with (previous release)
              <Input className="font-mono" value={r.baseRef} onChange={(e) => update(i, { baseRef: e.target.value })} placeholder="release/1.3.0 or v1.3.0" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Release candidate
              <Input className="font-mono" value={r.headRef} onChange={(e) => update(i, { headRef: e.target.value })} placeholder="release/1.4.0" />
            </label>
          </fieldset>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          <GitCompareArrows />
          {save.isPending ? 'Saving…' : 'Compare'}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function Results({ data }: { data: CodeComparison }) {
  const [tab, setTab] = useState<ComparisonTab>(() => defaultTab(data))
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const shown = useMemo(() => filterComparison(data, deferred), [data, deferred])
  const counts = tabCounts(data)
  const shownCounts = tabCounts(shown)

  return (
    <div className="space-y-3">
      {data.notes.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {data.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      )}
      {data.jira?.truncated && <p className="text-sm text-muted-foreground">The Jira version has more than 1000 issues; only the first 1000 were compared.</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Differences" className="flex flex-wrap gap-1 rounded-lg border p-1">
          {TAB_ORDER.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              onClick={() => setTab(t)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm',
                tab === t ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {TABS[t].label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  t !== 'matched' && counts[t] > 0 ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'bg-muted-foreground/10',
                )}
              >
                {deferred.trim() ? `${shownCounts[t]}/${counts[t]}` : counts[t]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Filter by issue, title, branch or author"
            placeholder="Filter by key, title, branch…"
            className="h-8 pr-8 pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" aria-label="Clear filter" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setQuery('')}>
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div role="tabpanel" id={`panel-${tab}`} className="space-y-2">
        <p className="text-xs text-muted-foreground">{TABS[tab].hint}</p>
        {tab === 'jiraOnly' && <IssueList issues={sortJiraOnly(shown.jiraOnly)} empty="Every issue in the Jira version has merged changes." />}
        {tab === 'codeOnly' && <CodeOnlyList items={shown.codeOnly} />}
        {tab === 'noKey' && (
          <>
            <ChangeList changes={shown.noKey} empty="Every merged pull request mentions an issue." />
            <Collapsible title={`Other commits without an issue (${shown.otherCommits.length})`} hint="Direct commits, and the individual commits inside merged pull requests.">
              <ChangeList changes={shown.otherCommits} empty="None." />
            </Collapsible>
            <Collapsible title={`Merges of other branches (${shown.syncMerges.length})`} hint="Merges that bring main or another release branch in; not counted as changes.">
              <ChangeList changes={shown.syncMerges} empty="None." />
            </Collapsible>
          </>
        )}
        {tab === 'matched' && (
          <Rows empty="Nothing matches yet.">
            {shown.matched.map((m) => (
              <Row key={m.issue.key}>
                <IssueLine issue={m.issue} />
                <ChangeChips changes={m.changes} />
              </Row>
            ))}
          </Rows>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Compared {formatTimestamp(data.comparedAt)}.</p>
    </div>
  )
}

function Rows({ children, empty }: { children: ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>
  return <ul className="divide-y rounded-lg border">{children}</ul>
}

function Row({ children }: { children: ReactNode }) {
  return <li className="space-y-1 px-3 py-2 text-sm">{children}</li>
}

function IssueLine({ issue }: { issue: JiraIssue }) {
  const cat = CATEGORY[issue.statusCategory]
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <ExternalAnchor href={issue.url} className="font-mono text-xs font-medium">
        {issue.key}
      </ExternalAnchor>
      <Badge className={cn('font-normal', cat.className)}>{issue.status}</Badge>
      <span className="text-xs text-muted-foreground">{issue.type}</span>
      <span className="min-w-0 flex-1 truncate" title={issue.summary}>
        {issue.summary}
      </span>
      {issue.assignee && <span className="text-xs text-muted-foreground">{issue.assignee}</span>}
    </div>
  )
}

function IssueList({ issues, empty }: { issues: JiraIssue[]; empty: string }) {
  return (
    <Rows empty={empty}>
      {issues.map((i) => (
        <Row key={i.key}>
          <IssueLine issue={i} />
        </Row>
      ))}
    </Rows>
  )
}

function CodeOnlyList({ items }: { items: CodeComparison['codeOnly'] }) {
  return (
    <Rows empty="Nothing merged mentions issues outside this version.">
      {items.map((x) => {
        const jira = x.jira !== 'unknown' && x.jira !== null ? x.jira : null
        return (
          <Row key={x.key}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              {jira ? (
                <ExternalAnchor href={jira.url} className="font-mono text-xs font-medium">
                  {x.key}
                </ExternalAnchor>
              ) : (
                <span className="font-mono text-xs font-medium">{x.key}</span>
              )}
              <Badge variant="secondary" className="font-normal">
                {elsewhereLabel(x.jira)}
              </Badge>
              {jira && (
                <span className="min-w-0 flex-1 truncate" title={jira.summary}>
                  {jira.summary}
                </span>
              )}
            </div>
            <ChangeChips changes={x.changes} />
          </Row>
        )
      })}
    </Rows>
  )
}

function ChangeList({ changes, empty }: { changes: CodeChange[]; empty: string }) {
  return (
    <Rows empty={empty}>
      {changes.map((ch) => (
        <Row key={`${ch.repo}${ch.ref}`}>
          <ChangeLine change={ch} />
        </Row>
      ))}
    </Rows>
  )
}

function ChangeLine({ change }: { change: CodeChange }) {
  const Icon = change.kind === 'pr' ? GitPullRequest : change.kind === 'merge' ? GitMerge : GitCompareArrows
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label={change.kind === 'pr' ? 'Pull request' : change.kind === 'merge' ? 'Merge' : 'Commit'} />
      <ExternalAnchor href={change.url} className="font-mono text-xs">
        {change.ref}
      </ExternalAnchor>
      <span className="min-w-0 flex-1 truncate" title={change.title}>
        {change.title}
      </span>
      {change.branch && <span className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground">{change.branch}</span>}
      {change.author && <span className="text-xs text-muted-foreground">{change.author}</span>}
      <span className="text-xs text-muted-foreground">{change.repo}</span>
    </div>
  )
}

function ChangeChips({ changes }: { changes: CodeChange[] }) {
  return (
    <ul className="space-y-0.5 pl-1">
      {changes.map((ch) => (
        <li key={`${ch.repo}${ch.ref}`} className="text-muted-foreground">
          <ChangeLine change={ch} />
        </li>
      ))}
    </ul>
  )
}

function Collapsible({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border px-3 py-2 text-sm">
      <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">{title}</summary>
      <p className="mt-1 mb-2 text-xs text-muted-foreground">{hint}</p>
      {children}
    </details>
  )
}

function ExternalAnchor({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const safe = safeHttpUrl(href)
  if (!safe) return <span className={className}>{children}</span>
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={cn('hover:underline', className)}>
      {children}
    </a>
  )
}
