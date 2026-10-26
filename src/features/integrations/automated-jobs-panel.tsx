import { useState } from 'react'
import { Link } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ReportType } from '@/types/domain'
import type { FollowedBuild, RunPurpose } from './api'
import type { TestAnalysis } from '@/features/automation/api'
import { FailedTests } from '@/features/automation/failed-tests'
import { JenkinsStarts } from '@/features/automation/jenkins-starts'
import { useTestAnalyses } from '@/features/automation/queries'
import { FollowedCard, FollowForm } from './followed-builds-section'
import { useConnected, useFollowedBuilds } from './queries'

const SLOTS: { purpose: Exclude<RunPurpose, 'AUTOMATED'>; label: string }[] = [
  { purpose: 'LOAD_TEST', label: 'Load Test' },
  { purpose: 'LONGEVITY', label: 'Longevity' },
  { purpose: 'HIT', label: 'HIT' },
]

/**
 * The Jenkins runs of this release candidate, inside the Automated jobs step:
 * one per report type plus any other job. Their results drive the step and
 * fill the report links.
 */
export function AutomatedJobsPanel({
  releaseId,
  projectId,
  reportTypes,
  canEdit,
  canManage = false,
}: {
  releaseId: string
  projectId: string
  reportTypes: readonly ReportType[]
  canEdit: boolean
  canManage?: boolean
}) {
  const { jenkins } = useConnected(projectId)
  const { data: runs = [], isLoading } = useFollowedBuilds(releaseId, !!jenkins)
  const { data: analyses = [] } = useTestAnalyses(releaseId)
  const [addingOther, setAddingOther] = useState(false)

  if (!jenkins) {
    return (
      <p className="text-xs text-muted-foreground">
        Connect Jenkins in <Link to="/settings/project" className="underline">project settings</Link> to add the links of the Load Test, Longevity and HIT jobs here.
      </p>
    )
  }
  if (isLoading) return <Skeleton className="h-24 w-full" />

  const slots = SLOTS.filter((s) => reportTypes.includes(s.purpose))
  const others = runs.filter((r) => r.purpose === 'AUTOMATED')

  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-xs font-medium">Jenkins jobs</h4>
        <p className="text-xs font-normal text-muted-foreground">
          Start the jobs from here, or paste the link of each running job. This step completes when they all finish (passed or unstable) and is blocked if one fails
          or is aborted; a finished job fills its report link.
        </p>
      </div>
      <JenkinsStarts releaseId={releaseId} projectId={projectId} canEdit={canEdit} canManage={canManage} />
      <ul className="space-y-2">
        {slots.map((slot) => (
          <Slot
            key={slot.purpose}
            releaseId={releaseId}
            label={slot.label}
            purpose={slot.purpose}
            run={runs.find((r) => r.purpose === slot.purpose)}
            parent={runs.find((p) => p.id === runs.find((r) => r.purpose === slot.purpose)?.parent_run_id)}
            analysis={analyses.find((a) => a.run_id === runs.find((r) => r.purpose === slot.purpose)?.id)}
            canEdit={canEdit}
          />
        ))}
        {others.map((run) => (
          <li key={run.id}>
            <FollowedCard
              followed={run}
              releaseId={releaseId}
              canEdit={canEdit}
              heading={runs.some((r) => r.parent_run_id === run.id) ? 'Parent job' : 'Job'}
            />
          </li>
        ))}
      </ul>
      {canEdit &&
        (addingOther ? (
          <FollowForm releaseId={releaseId} purpose="AUTOMATED" onDone={() => setAddingOther(false)} />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAddingOther(true)}>
            <Plus />
            Add another job
          </Button>
        ))}
    </div>
  )
}

function Slot({
  releaseId,
  label,
  purpose,
  run,
  parent,
  analysis,
  canEdit,
}: {
  releaseId: string
  label: string
  purpose: RunPurpose
  run: FollowedBuild | undefined
  /** The parent run that started it, if any. */
  parent?: FollowedBuild
  /** Failed tests of its report and their Jira bugs. */
  analysis?: TestAnalysis
  canEdit: boolean
}) {
  const [replacing, setReplacing] = useState(false)
  if (run && !replacing) {
    return (
      <li className="space-y-1">
        <FollowedCard
          followed={run}
          releaseId={releaseId}
          canEdit={canEdit}
          heading={label}
          note={parent ? `Started by ${parent.status?.name ?? `${parent.job_path} #${parent.build_number}`}` : undefined}
        />
        <FailedTests releaseId={releaseId} runId={run.id} analysis={analysis} canEdit={canEdit} />
        {canEdit && (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setReplacing(true)}>
            Replace with a new run…
          </button>
        )}
      </li>
    )
  }
  return (
    <li className="space-y-1 rounded-lg border border-dashed p-3 text-sm">
      <p className="font-medium">
        {label} <span className="font-normal text-muted-foreground">{run ? '· replace the run' : '· not added yet'}</span>
      </p>
      {canEdit ? (
        <FollowForm releaseId={releaseId} purpose={purpose} withLabel={false} cancellable={!!run} onDone={() => setReplacing(false)} />
      ) : (
        <p className="text-xs text-muted-foreground">A member can add the job’s link.</p>
      )}
    </li>
  )
}
