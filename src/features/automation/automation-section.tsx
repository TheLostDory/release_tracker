import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Project } from '@/features/projects/api'
import { SettingsSection } from '@/features/projects/settings/settings-section'
import { toUserMessage } from '@/lib/errors'
import { STEP_BY_TYPE } from '@/lib/workflow'
import type { AutomationSettings, EmailStep } from './api'
import { JobsEditor } from './jobs-editor'
import { useAutomation, useSaveAutomation } from './queries'

/** Project settings → Automation: what the tracker does by itself. */
export function AutomationSection({ project, canManage }: { project: Project; canManage: boolean }) {
  const { data, isLoading } = useAutomation(project.id)
  return (
    <SettingsSection
      title="Automation"
      description="What the tracker does by itself for this project. Background tasks run while the app is running."
    >
      {isLoading || !data ? (
        <div className="h-24 animate-pulse rounded-md bg-muted/50" />
      ) : (
        <AutomationForm key={JSON.stringify(data)} project={project} initial={data} canManage={canManage} />
      )}
    </SettingsSection>
  )
}

function AutomationForm({ project, initial, canManage }: { project: Project; initial: AutomationSettings; canManage: boolean }) {
  const [s, setS] = useState(initial)
  const save = useSaveAutomation(project.id)
  const dirty = JSON.stringify(s) !== JSON.stringify(initial)
  const set = <K extends keyof AutomationSettings>(key: K, value: AutomationSettings[K]) => setS((prev) => ({ ...prev, [key]: value }))

  return (
    <div className="space-y-4">
      <fieldset disabled={!canManage} className="space-y-4">
        <Block
          title="Plan step dates"
          enabled={s.planDates.enabled}
          onToggle={(enabled) => set('planDates', { ...s.planDates, enabled })}
          description="New releases get a planned date for every step, counted back from the target deployment date (weekends move to the Friday before). When the target moves, open steps move with it."
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {project.enabled_steps.map((type) => (
              <label key={type} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{STEP_BY_TYPE[type].name}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    className="h-7 w-16 text-right"
                    aria-label={`${STEP_BY_TYPE[type].name}: days before target`}
                    value={s.planDates.offsets[type] ?? 0}
                    onChange={(e) =>
                      set('planDates', { ...s.planDates, offsets: { ...s.planDates.offsets, [type]: Math.max(0, Math.min(365, Number(e.target.value) || 0)) } })
                    }
                  />
                  days before
                </span>
              </label>
            ))}
          </div>
        </Block>

        <Block
          title="Start Jenkins jobs"
          description={
            <>
              The Automated jobs step gets a “Start jobs” button that starts these jobs and follows the runs they become (no links to
              paste). Parameters can use {'{{version}}'} and {'{{name}}'}. <strong>One job starts the others?</strong> Add it as
              “Other job / parent”: the Load Test, Longevity and HIT runs it starts fill their slots by themselves (recognised by name, or
              list them here as “started by another job”).
            </>
          }
        >
          <JobsEditor jobs={s.jenkins.jobs} onChange={(jobs) => set('jenkins', { ...s.jenkins, jobs })} />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={s.jenkins.autoStart}
              onChange={(e) => set('jenkins', { ...s.jenkins, autoStart: e.target.checked })}
            />
            Start them by themselves when RC creation completes
          </label>
        </Block>

        <Block
          title="Complete steps automatically"
          description="Checked every 5 minutes for releases that aren’t deployed; each completion is noted in the release’s activity."
        >
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={s.autoComplete.rcCreationFromGithub}
                onChange={(e) => set('autoComplete', { ...s.autoComplete, rcCreationFromGithub: e.target.checked })}
              />
              RC creation, when the RC branch exists on GitHub (in every repository)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={s.autoComplete.deploymentFromJira}
                onChange={(e) => set('autoComplete', { ...s.autoComplete, deploymentFromJira: e.target.checked })}
              />
              Deployment, when the Jira version is released (its release date becomes the deployment date)
            </label>
          </div>
        </Block>

        <Block title="Follow Jira" description="Checked every 10 minutes for projects connected to Jira.">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={s.jiraSync.syncDates}
                onChange={(e) => set('jiraSync', { ...s.jiraSync, syncDates: e.target.checked })}
              />
              Target dates (and renamed versions) follow the linked Jira versions
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={s.jiraSync.importVersions}
                onChange={(e) => set('jiraSync', { ...s.jiraSync, importVersions: e.target.checked })}
              />
              New unreleased Jira versions become releases (versions more than a month overdue are skipped)
            </label>
          </div>
        </Block>

        <Block
          title="Code vs Jira in the background"
          enabled={s.codeCheck.background}
          onToggle={(background) => set('codeCheck', { background })}
          description="Releases with a comparison set up are re-checked every hour, so the releases list and the dashboard stay current; Teams is told when differences go up (if the Teams notification is on)."
        />

        <Block
          title="Email drafts"
          description="RC email, RC escalation email and Release email get a “Draft email” button, written from the release’s data. Default recipients (separate with ; or ,):"
        >
          <div className="space-y-2">
            {EMAILS.map(({ step, label }) => (
              <div key={step} className="grid items-center gap-2 sm:grid-cols-[10rem_1fr_1fr]">
                <span className="text-sm">{label}</span>
                <Input
                  aria-label={`${label}: to`}
                  placeholder="To"
                  className="h-8"
                  value={s.emails.recipients[step].to}
                  onChange={(e) => set('emails', { recipients: { ...s.emails.recipients, [step]: { ...s.emails.recipients[step], to: e.target.value } } })}
                />
                <Input
                  aria-label={`${label}: cc`}
                  placeholder="Cc"
                  className="h-8"
                  value={s.emails.recipients[step].cc}
                  onChange={(e) => set('emails', { recipients: { ...s.emails.recipients, [step]: { ...s.emails.recipients[step], cc: e.target.value } } })}
                />
              </div>
            ))}
          </div>
        </Block>
      </fieldset>

      {canManage ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() =>
              // Rows left without a job path are dropped rather than refused.
              save.mutate({ ...s, jenkins: { ...s.jenkins, jobs: s.jenkins.jobs.filter((j) => j.jobPath.trim()) } }, {
                onSuccess: () => toast.success('Automation saved'),
                onError: (err) => toast.error(toUserMessage(err)),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save automation'}
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setS(initial)}>
              Discard changes
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only admins and owners can change automation.</p>
      )}
    </div>
  )
}

const EMAILS: { step: EmailStep; label: string }[] = [
  { step: 'RC_EMAIL', label: 'RC email' },
  { step: 'RC_ESCALATION_EMAIL', label: 'RC escalation email' },
  { step: 'RELEASE_EMAIL', label: 'Release email' },
]

/** One automation: a switch (when it can be turned off), what it does, and its options (shown while on). */
export function Block({
  title,
  description,
  enabled = true,
  onToggle,
  children,
}: {
  title: string
  description: ReactNode
  enabled?: boolean
  onToggle?: (enabled: boolean) => void
  children?: ReactNode
}) {
  const heading = (
    <span>
      <span className="text-sm font-medium">{title}</span>
      <span className="block text-xs text-muted-foreground">{description}</span>
    </span>
  )
  return (
    <div className="space-y-2 rounded-md border p-3">
      {onToggle ? (
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-foreground" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          {heading}
        </label>
      ) : (
        heading
      )}
      {enabled && children && <div className={onToggle ? 'pl-6' : undefined}>{children}</div>}
    </div>
  )
}
