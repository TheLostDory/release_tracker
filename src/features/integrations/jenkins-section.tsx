import { useState, type FormEvent } from 'react'
import { ChevronRight, ExternalLink, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { ReleaseDetail } from '@/features/releases/api'
import { formatTimestamp } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { JenkinsJob, JenkinsPurpose } from './api'
import { BuildResultBadge } from './build-result-badge'
import { formatDuration as duration } from './followed-builds'
import { FollowedBuilds } from './followed-builds-section'
import { parseParameters } from './parameters'
import {
  useConnected,
  useJenkinsBuilds,
  useJenkinsJobs,
  useLinkJenkinsJob,
  useRunJenkinsJob,
  useSyncJenkins,
  useUnlinkJenkinsJob,
} from './queries'

const PURPOSES: Record<JenkinsPurpose, { label: string; hint: string }> = {
  AUTOMATED: { label: 'Automated jobs', hint: 'Passing builds complete the “Automated jobs” step; failures block it.' },
  LOAD_TEST: { label: 'Load Test report', hint: 'The build’s HTML report becomes the Load Test report link.' },
  LONGEVITY: { label: 'Longevity report', hint: 'The build’s HTML report becomes the Longevity report link.' },
  HIT: { label: 'HIT report', hint: 'The build’s HTML report becomes the HIT report link.' },
  OTHER: { label: 'Other', hint: 'Shown with its builds; doesn’t change the workflow.' },
}

export function JenkinsSection({ release, canEdit }: { release: ReleaseDetail; canEdit: boolean }) {
  const { jenkins } = useConnected(release.project_id)
  const { data: jobs = [], isLoading } = useJenkinsJobs(release.id, !!jenkins)
  const sync = useSyncJenkins(release.id)
  const [adding, setAdding] = useState(false)
  if (!jenkins) return null

  return (
    <section aria-labelledby="jenkins-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="jenkins-heading" className="text-sm font-medium text-muted-foreground">
          Jenkins
        </h2>
        {canEdit && (
          <div className="flex gap-1">
            {jobs.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={sync.isPending}
                onClick={() =>
                  sync.mutate(undefined, {
                    onSuccess: (r) => (r.failed ? toast.error(`${r.failed} job(s) couldn’t be read from Jenkins`) : toast.success('Synced with Jenkins')),
                    onError: (err) => toast.error(toUserMessage(err)),
                  })
                }
              >
                <RefreshCw className={cn(sync.isPending && 'animate-spin')} />
                Sync now
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
              <Plus />
              Link job
            </Button>
          </div>
        )}
      </div>

      {adding && <LinkJobForm releaseId={release.id} onDone={() => setAdding(false)} />}

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : jobs.length === 0 ? (
        !adding && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No Jenkins jobs linked.{canEdit && ' Link the jobs that build and test this release.'}
          </p>
        )
      ) : (
        <ul className="divide-y rounded-lg border">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} releaseId={release.id} canEdit={canEdit} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Checked automatically every 2 minutes until the release is deployed.</p>

      <FollowedBuilds releaseId={release.id} canEdit={canEdit} />
    </section>
  )
}

function JobRow({ job, releaseId, canEdit }: { job: JenkinsJob; releaseId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const run = useRunJenkinsJob(releaseId)
  const unlink = useUnlinkJenkinsJob(releaseId)
  const builds = useJenkinsBuilds(job.id, open)
  const b = job.last_build
  const params = Object.entries(job.parameters)

  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="ghost" size="icon-xs" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} builds of ${job.job_path}`} onClick={() => setOpen(!open)}>
          <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
        </Button>
        <span className="min-w-0 flex-1">
          <span className="font-mono text-xs">{job.job_path}</span>
          <span className="ml-2 text-xs text-muted-foreground">{PURPOSES[job.purpose].label}</span>
        </span>
        <BuildResultBadge build={b} />
        {b && (
          <a href={b.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground tabular-nums hover:underline">
            #{b.number} · {formatTimestamp(new Date(b.timestamp).toISOString())}
            {!b.building && ` · ${duration(b.duration)}`} <ExternalLink className="inline size-3" aria-hidden />
          </a>
        )}
        {canEdit && (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={run.isPending}
              onClick={() =>
                run.mutate(job.id, {
                  onSuccess: () => toast.success(`Started ${job.job_path}${params.length ? ' with parameters' : ''}`),
                  onError: (err) => toast.error(toUserMessage(err)),
                })
              }
            >
              <Play />
              Run
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Unlink ${job.job_path}`} onClick={() => setRemoving(true)}>
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      {job.last_error && <p className="mt-1 pl-8 text-xs text-red-600 dark:text-red-400">{job.last_error}</p>}
      {open && (
        <div className="mt-2 space-y-2 pl-8">
          {params.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Parameters: {params.map(([k, v]) => `${k}=${v}`).join(', ')}
            </p>
          )}
          {builds.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : builds.error ? (
            <p className="text-xs text-destructive">{toUserMessage(builds.error)}</p>
          ) : (
            <ul className="space-y-1">
              {(builds.data ?? []).map((x) => (
                <li key={x.number} className="flex items-center gap-2 text-xs">
                  <BuildResultBadge build={x} />
                  <a href={x.url} target="_blank" rel="noopener noreferrer" className="tabular-nums hover:underline">
                    #{x.number}
                  </a>
                  <span className="text-muted-foreground tabular-nums">{formatTimestamp(new Date(x.timestamp).toISOString())}</span>
                  {!x.building && <span className="text-muted-foreground tabular-nums">{duration(x.duration)}</span>}
                  {x.reportUrl && (
                    <a href={x.reportUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:underline">
                      report
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmDeleteDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Unlink ${job.job_path}?`}
        description="The job stays in Jenkins. This release stops syncing with it; steps it already completed stay completed."
        confirmLabel="Unlink"
        pending={unlink.isPending}
        onConfirm={() =>
          unlink.mutate(job.id, {
            onSuccess: () => setRemoving(false),
            onError: (err) => toast.error(toUserMessage(err)),
          })
        }
      />
    </li>
  )
}

function LinkJobForm({ releaseId, onDone }: { releaseId: string; onDone: () => void }) {
  const link = useLinkJenkinsJob(releaseId)
  const [jobPath, setJobPath] = useState('')
  const [purpose, setPurpose] = useState<JenkinsPurpose>('AUTOMATED')
  const [paramText, setParamText] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const { params, error: paramError } = parseParameters(paramText)
    if (paramError) return setError(paramError)
    setError(null)
    try {
      await link.mutateAsync({ jobPath: jobPath.trim(), purpose, parameters: params })
      toast.success('Job linked; latest build loaded')
      onDone()
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
      <FormField label="Job" hint="Path like folder/job-name, or paste the job’s Jenkins URL.">
        {(p) => <Input {...p} autoFocus required value={jobPath} onChange={(e) => setJobPath(e.target.value)} placeholder="platform/integration-tests" />}
      </FormField>
      <FormField label="Purpose" hint={PURPOSES[purpose].hint}>
        {(p) => (
          <Select value={purpose} onValueChange={(v) => setPurpose(v as JenkinsPurpose)}>
            <SelectTrigger {...p} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PURPOSES) as JenkinsPurpose[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {PURPOSES[k].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      <FormField label="Build parameters (optional)" hint="One KEY=value per line. {{version}} and {{name}} are replaced when you click Run." className="space-y-1.5 md:col-span-2">
        {(p) => <Textarea {...p} rows={2} className="font-mono text-xs" value={paramText} onChange={(e) => setParamText(e.target.value)} placeholder={'RC_VERSION={{version}}\nENV=staging'} />}
      </FormField>
      {error && (
        <p role="alert" className="text-sm text-destructive md:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" size="sm" disabled={link.isPending || !jobPath.trim()}>
          {link.isPending ? 'Checking job…' : 'Link job'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
