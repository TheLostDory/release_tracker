import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toUserMessage } from '@/lib/errors'
import { previewTestReport, type AutomationSettings } from './api'
import { SearchedFor } from './failed-tests'

type Settings = AutomationSettings['testFailures']

const PURPOSES: { key: Settings['purposes'][number]; label: string }[] = [
  { key: 'HIT', label: 'HIT' },
  { key: 'LOAD_TEST', label: 'Load Test' },
  { key: 'LONGEVITY', label: 'Longevity' },
]

/** Options of "Failed tests → Jira bugs", with a way to try the reading on a real report. */
export function TestFailuresSettings({ projectId, value, onChange }: { projectId: string; value: Settings; onChange: (v: Settings) => void }) {
  const [bugTypes, setBugTypes] = useState(value.bugTypes.join(', '))
  const [reportUrl, setReportUrl] = useState('')
  const preview = useMutation({ mutationFn: () => previewTestReport(projectId, reportUrl.trim(), value.failedPattern) })

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs text-muted-foreground">For runs of:</span>
        {PURPOSES.map((p) => (
          <label key={p.key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={value.purposes.includes(p.key)}
              onChange={(e) => onChange({ ...value, purposes: e.target.checked ? [...value.purposes, p.key] : value.purposes.filter((x) => x !== p.key) })}
            />
            {p.label}
          </label>
        ))}
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Jira issue types that count as bugs (comma-separated)</span>
        <Input
          className="h-8"
          value={bugTypes}
          onChange={(e) => setBugTypes(e.target.value)}
          onBlur={() => {
            const types = bugTypes.split(',').map((t) => t.trim()).filter(Boolean)
            onChange({ ...value, bugTypes: types.length ? types : ['Bug'] })
          }}
        />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-foreground" checked={value.allProjects} onChange={(e) => onChange({ ...value, allProjects: e.target.checked })} />
        Search every Jira project (not only the connected one)
      </label>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">
          Where the report is, relative to the build (optional: an .html artifact, HTML Publisher’s <code className="font-mono">HTML_20Report/</code> and report
          links on the build page are found by themselves; Gauge reports are read spec by spec):
        </span>
        <div className="grid gap-2 sm:grid-cols-3">
          {PURPOSES.filter((p) => value.purposes.includes(p.key)).map((p) => (
            <label key={p.key} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0">{p.label}</span>
              <Input
                className="h-8 font-mono text-xs"
                placeholder="found automatically"
                value={value.reportPaths?.[p.key] ?? ''}
                onChange={(e) =>
                  onChange({ ...value, reportPaths: { LOAD_TEST: '', LONGEVITY: '', HIT: '', ...value.reportPaths, [p.key]: e.target.value } })
                }
              />
            </label>
          ))}
        </div>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">
          Failed tests in the report: leave empty to read common layouts (rows marked FAIL / FAILED / ERROR), or give a regular expression whose first
          group is the test name, e.g. <code className="font-mono">^(HIT-.+?) FAIL</code>
        </span>
        <Input className="h-8 font-mono text-xs" value={value.failedPattern} onChange={(e) => onChange({ ...value, failedPattern: e.target.value })} placeholder="(built-in reading)" />
      </label>
      <div className="space-y-1 rounded-md border border-dashed p-2">
        <span className="text-xs text-muted-foreground">Try it on a real report (paste its link from Jenkins, e.g. …/job/…/42/HTML_20Report/):</span>
        <div className="flex gap-2">
          <Input className="h-8 text-xs" placeholder="https://jenkins…/job/…/42/artifact/report.html" value={reportUrl} onChange={(e) => setReportUrl(e.target.value)} />
          <Button size="sm" variant="outline" disabled={!reportUrl.trim() || preview.isPending} onClick={() => preview.mutate()}>
            {preview.isPending ? 'Reading…' : 'Test'}
          </Button>
        </div>
        {preview.error && <p className="text-xs text-destructive">{toUserMessage(preview.error)}</p>}
        {preview.data && (
          <div className="text-xs">
            {preview.data.failedTests.length === 0 ? (
              <span className="text-muted-foreground">No failed tests found in that report.</span>
            ) : (
              <>
                <span className="text-muted-foreground">{preview.data.failedTests.length} failed tests found:</span>
                <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 font-mono">
                  {preview.data.failedTests.map((t) => (
                    <li key={t.name}>
                      {t.name}
                      <SearchedFor test={t} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground">How it was read</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {preview.data.how.map((line, i) => (
                  <li key={i} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
