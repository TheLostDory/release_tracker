import { Loader2, Play, X } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toUserMessage } from '@/lib/errors'
import { PURPOSE_LABEL } from './jobs'
import { useAutomation, useDismissJenkinsStart, useJenkinsStarts, useStartJenkinsJobs } from './queries'


/** "Start jobs" for the project's automated Jenkins jobs, and the starts still on their way. */
export function JenkinsStarts({ releaseId, projectId, canEdit, canManage }: { releaseId: string; projectId: string; canEdit: boolean; canManage: boolean }) {
  const { data: automation } = useAutomation(projectId)
  const { data: starts = [] } = useJenkinsStarts(releaseId, true)
  const start = useStartJenkinsJobs(releaseId)
  const dismiss = useDismissJenkinsStart(releaseId)
  // Jobs a parent starts aren't started from here.
  const jobs = (automation?.jenkins.jobs ?? []).filter((j) => !j.startedByParent)

  return (
    <div className="space-y-2">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {jobs.length > 0 ? (
            <Button
              size="sm"
              disabled={start.isPending}
              onClick={() =>
                start.mutate(undefined, {
                  onSuccess: (r) =>
                    r.queued === 0
                      ? toast.info('Those jobs are already starting')
                      : toast.success(`${r.queued} job${r.queued === 1 ? '' : 's'} started in Jenkins`),
                  onError: (err) => toast.error(toUserMessage(err)),
                })
              }
            >
              {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}
              Start jobs ({jobs.map((j) => (j.purpose === 'AUTOMATED' ? (j.jobPath.split('/').pop() ?? j.jobPath) : PURPOSE_LABEL[j.purpose])).join(', ')})
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {canManage ? (
                <>
                  To start the jobs from here, list them in <Link to="/settings/project" className="underline">Settings → Automation</Link>.
                </>
              ) : (
                'An admin can set up the jobs to start from here.'
              )}
            </span>
          )}
          {automation?.jenkins.autoStart && jobs.length > 0 && (
            <span className="text-xs text-muted-foreground">They also start by themselves when RC creation completes.</span>
          )}
        </div>
      )}
      {starts.length > 0 && (
        <ul className="space-y-1">
          {starts.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs">
              {s.state === 'failed' ? <X className="size-3.5 shrink-0 text-red-600" aria-hidden /> : <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-600" aria-hidden />}
              <span className="font-medium">{PURPOSE_LABEL[s.purpose]}</span>
              <span className="font-mono">{s.job_path}</span>
              <span className={s.state === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
                {s.state === 'to_start' ? 'starting…' : s.state === 'queued' ? 'waiting in the Jenkins queue…' : s.last_error}
              </span>
              {s.state === 'failed' && canEdit && (
                <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Dismiss" onClick={() => dismiss.mutate(s.id)}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
