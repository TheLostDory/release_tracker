import { useState } from 'react'
import { Bug, ChevronRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CATEGORY } from '@/features/integrations/jira-status'
import { safeHttpUrl } from '@/lib/safe-url'
import { cn } from '@/lib/utils'
import type { FailedTestRef, FoundBug, TestAnalysis } from './api'
import { byStatus } from './bug-order'
import { useAnalyzeRun } from './queries'

/** Under a HIT / Load Test run: its failed tests and the Jira bugs linked to each. */
export function FailedTests({ releaseId, runId, analysis, canEdit }: { releaseId: string; runId: string; analysis: TestAnalysis | undefined; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  const [reportUrl, setReportUrl] = useState('')
  const analyze = useAnalyzeRun(releaseId)
  if (!analysis) return null

  const again = canEdit && (
    <Button size="xs" variant="ghost" className="h-6 px-2" disabled={analyze.isPending || analysis.state === 'pending'} onClick={() => analyze.mutate({ runId })}>
      <RefreshCw className={cn(analyze.isPending && 'animate-spin')} />
      Check again
    </Button>
  )

  if (analysis.state === 'pending') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading failed tests from the report and looking for their Jira bugs…
      </p>
    )
  }
  if (analysis.state === 'failed') {
    return (
      <div className="space-y-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Failed tests couldn’t be checked: {analysis.error}</span>
          {again}
        </div>
        {canEdit && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (reportUrl.trim()) analyze.mutate({ runId, reportUrl: reportUrl.trim() })
            }}
          >
            <Input
              aria-label="Report link"
              className="h-7 text-xs"
              placeholder="Report link, e.g. https://jenkins…/job/…/42/HTML_20Report/"
              value={reportUrl}
              onChange={(e) => setReportUrl(e.target.value)}
            />
            <Button type="submit" size="xs" variant="outline" className="h-7" disabled={!reportUrl.trim() || analyze.isPending}>
              Use this report
            </Button>
          </form>
        )}
      </div>
    )
  }

  const tests = analysis.result?.failedTests ?? []
  const linked = tests.filter((t) => t.bugs.length > 0).length
  if (tests.length === 0) {
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          No failed tests in the report. {again}
        </div>
        <HowRead how={analysis.result?.how} />
      </div>
    )
  }
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="flex items-center gap-1 font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          <Bug className="size-3.5 text-red-600 dark:text-red-400" aria-hidden />
          {tests.length} failed test{tests.length === 1 ? '' : 's'}
        </button>
        <span className="text-muted-foreground">
          {linked} linked to bugs · {tests.length - linked} without a bug
        </span>
        {again}
      </div>
      {open && (
        <ul className="space-y-1.5 pt-1 pl-5">
          {tests.map((t) => (
            <li key={t.name}>
              <span className="font-mono">{t.name}</span>
              <SearchedFor test={t} />
              {t.bugs.length === 0 ? (
                <span className="ml-2 text-amber-800 dark:text-amber-300">no bug found</span>
              ) : (
                <ul className="mt-0.5 space-y-0.5 pl-3">
                  {byStatus(t.bugs).map((b) => (
                    <BugLine key={b.key} bug={b} />
                  ))}
                </ul>
              )}
            </li>
          ))}
          {analysis.result?.notes.map((n) => (
            <li key={n} className="text-muted-foreground">
              {n}
            </li>
          ))}
          <li>
            <HowRead how={analysis.result?.how} />
          </li>
        </ul>
      )}
    </div>
  )
}

/** The steps the report was read with (to see why a test was, or wasn't, taken as failed). */
function HowRead({ how }: { how: string[] | undefined }) {
  if (!how?.length) return null
  return (
    <details>
      <summary className="cursor-pointer text-muted-foreground">How the report was read</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        {how.map((line, i) => (
          <li key={i} className="break-all">
            {line}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** What Jira was searched for: the script name / IDs. */
export function SearchedFor({ test }: { test: FailedTestRef }) {
  const ids = test.ids ?? []
  if (!ids.length) return null
  return (
    <span className="ml-2 text-muted-foreground">
      script <span className="font-mono text-foreground">{test.script ?? ids[0]}</span>
      {ids.filter((id) => id !== test.script).length > 0 && <> · also searched {ids.filter((id) => id !== test.script).join(', ')}</>}
    </span>
  )
}

function BugLine({ bug }: { bug: FoundBug }) {
  const href = safeHttpUrl(bug.url)
  const cat = CATEGORY[(bug.statusCategory as keyof typeof CATEGORY) in CATEGORY ? (bug.statusCategory as keyof typeof CATEGORY) : 'unknown']
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono font-medium hover:underline">
          {bug.key} <ExternalLink className="inline size-3" aria-hidden />
        </a>
      ) : (
        <span className="font-mono font-medium">{bug.key}</span>
      )}
      <span className="text-muted-foreground">{bug.type}</span>
      <Badge className={cn('h-4 px-1.5 text-[10px] font-normal', cat.className)}>{bug.status}</Badge>
      <span className="min-w-0 truncate">{bug.summary}</span>
      <span className="text-muted-foreground">({bug.via})</span>
    </li>
  )
}
