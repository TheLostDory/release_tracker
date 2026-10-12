import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { ReportResultBadge } from '@/components/status-badges'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatTimestamp } from '@/lib/dates'
import { safeHttpUrl } from '@/lib/safe-url'
import { REPORT_RESULT_LABELS } from '@/lib/status-labels'
import { cn } from '@/lib/utils'
import { REPORT_LABELS, REVIEW_STEP_FOR_REPORT, unmetDependencies, type WorkflowStep } from '@/lib/workflow'
import type { ReportResult, TaskStatus } from '@/types/domain'
import type { ReleaseReport, ReleaseTask, ReportPatch } from '../api'
import { managedCardId } from './card-ids'

const RESULTS: ReportResult[] = ['PASS', 'WARNING', 'FAIL']

const RESULT_ACTIVE: Record<ReportResult, string> = {
  PASS: 'bg-emerald-600 text-white hover:bg-emerald-600/90 border-emerald-600',
  WARNING: 'bg-amber-500 text-white hover:bg-amber-500/90 border-amber-500',
  FAIL: 'bg-red-600 text-white hover:bg-red-600/90 border-red-600',
  NOT_REVIEWED: '',
}

interface Props {
  reports: readonly ReleaseReport[]
  tasks: readonly ReleaseTask[]
  onUpdate: (id: string, patch: ReportPatch) => void
  guard: (stepName: string, unmet: WorkflowStep[], proceed: () => void) => void
  readOnly?: boolean
}

export function ReportCards({ reports, tasks, onUpdate, guard, readOnly = false }: Props) {
  if (reports.length === 0) {
    return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">This project doesn't use report reviews.</p>
  }
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {reports.map((r) => (
        <ReportCard key={r.id} report={r} tasks={tasks} onUpdate={onUpdate} guard={guard} readOnly={readOnly} />
      ))}
    </div>
  )
}

function ReportCard({ report, tasks, onUpdate, guard, readOnly }: { report: ReleaseReport } & Omit<Props, 'reports'>) {
  const [urlError, setUrlError] = useState<string | null>(null)
  const label = REPORT_LABELS[report.report_type]
  const reviewStep = REVIEW_STEP_FOR_REPORT[report.report_type]
  const safeUrl = safeHttpUrl(report.report_url)
  const reviewed = report.result !== 'NOT_REVIEWED'

  function setResult(result: ReportResult) {
    if (result === report.result) return
    const apply = () => onUpdate(report.id, { result })
    if (result === 'NOT_REVIEWED') apply()
    else guard(`${label} review`, unmetDependencies(reviewStep, tasks), apply)
  }

  function setStatus(status: TaskStatus) {
    if (status !== report.status) onUpdate(report.id, { status })
  }

  return (
    <section
      id={managedCardId(reviewStep)}
      tabIndex={-1}
      aria-label={`${label} report`}
      className={cn(
        'flex scroll-mt-16 flex-col gap-3 rounded-lg border p-3 transition-shadow outline-none',
        report.result === 'FAIL' && 'border-red-500/40',
        report.status === 'SKIPPED' && 'opacity-70',
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        {report.status === 'SKIPPED' ? (
          <span className="text-xs text-muted-foreground">Skipped</span>
        ) : (
          <ReportResultBadge result={report.result} />
        )}
      </header>

      <div role="group" aria-label={`${label} result`} className="grid grid-cols-3 gap-1">
        {RESULTS.map((result) => (
          <Button
            key={result}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={report.result === result}
            className={cn(report.result === result && RESULT_ACTIVE[result])}
            onClick={() => setResult(result)}
            disabled={readOnly || report.status === 'SKIPPED'}
          >
            {REPORT_RESULT_LABELS[result]}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {readOnly ? null : reviewed ? (
          <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => setResult('NOT_REVIEWED')}>
            Reset review
          </Button>
        ) : report.status === 'SKIPPED' ? (
          <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => setStatus('NOT_STARTED')}>
            Un-skip
          </Button>
        ) : (
          <>
            {report.status !== 'IN_PROGRESS' && (
              <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => setStatus('IN_PROGRESS')}>
                Start review
              </Button>
            )}
            <Button variant="link" size="xs" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => setStatus('SKIPPED')}>
              Skip (not required)
            </Button>
          </>
        )}
        {report.status === 'IN_PROGRESS' && !reviewed && <span className="text-blue-700 dark:text-blue-400">Review in progress</span>}
      </div>

      <div className="space-y-1">
        <div className="flex gap-1">
          <Input
            key={`url-${report.report_url}`}
            type="url"
            aria-label={`${label} report URL`}
            placeholder="Report URL"
            readOnly={readOnly}
            defaultValue={report.report_url ?? ''}
            aria-invalid={urlError ? true : undefined}
            className="h-8 text-sm"
            onBlur={(e) => {
              const raw = e.target.value.trim()
              if (raw && !safeHttpUrl(raw)) {
                setUrlError('Use a full http(s):// URL.')
                return
              }
              setUrlError(null)
              if ((raw || null) !== report.report_url) onUpdate(report.id, { report_url: raw || null })
            }}
          />
          {safeUrl && (
            <Button asChild variant="outline" size="icon" className="size-8 shrink-0">
              <a href={safeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label} report`}>
                <ExternalLink />
              </a>
            </Button>
          )}
        </div>
        {urlError && <p className="text-xs text-destructive">{urlError}</p>}
      </div>

      <Textarea
        key={`notes-${report.notes}`}
        aria-label={`${label} notes`}
        placeholder={readOnly ? 'No notes' : 'Findings, thresholds, follow-ups…'}
        readOnly={readOnly}
        rows={2}
        defaultValue={report.notes ?? ''}
        className="text-sm"
        onBlur={(e) => {
          const value = e.target.value.trim() || null
          if (value !== report.notes) onUpdate(report.id, { notes: value })
        }}
      />

      <p className="mt-auto text-xs text-muted-foreground">
        {reviewed && report.reviewed_at
          ? `Reviewed by ${report.reviewer?.name ?? 'unknown'} · ${formatTimestamp(report.reviewed_at)}`
          : 'Not reviewed yet'}
      </p>
    </section>
  )
}
