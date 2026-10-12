import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-context'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { useProjectMembers } from '@/features/projects/queries'
import { useCurrentSprint } from '@/features/sprints/current-sprint-context'
import { formatDayRange } from '@/lib/dates'
import { RELEASE_STATUS_LABELS } from '@/lib/status-labels'
import { toUserMessage } from '@/lib/supabase-errors'
import type { ReleaseStatus } from '@/types/domain'
import type { ReleaseDetail, ReleaseInput } from './api'
import { useCreateRelease, useUpdateRelease } from './queries'
import { normalizeRelease, targetOutsideSprint, validateRelease, type ReleaseFormErrors } from './release-form'

/** Radix Select can't use "" as a value. */
const UNASSIGNED = '__unassigned'
const NO_SPRINT = '__no_sprint'
const AUTOMATIC = '__automatic'
const OVERRIDE_OPTIONS = Object.keys(RELEASE_STATUS_LABELS) as ReleaseStatus[]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this release; omit to create a new one. */
  release?: ReleaseDetail
  defaultSprintId?: string
}

export function ReleaseDialog({ open, onOpenChange, release, defaultSprintId }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <ReleaseForm release={release} defaultSprintId={defaultSprintId} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReleaseForm({
  release,
  defaultSprintId,
  onDone,
}: {
  release?: ReleaseDetail
  defaultSprintId?: string
  onDone: () => void
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { sprints, currentSprint } = useCurrentSprint()
  const { currentProject } = useCurrentProject()
  const projectId = release?.project_id ?? currentProject?.id ?? ''
  const sprintsEnabled = !!currentProject?.sprints_enabled
  const { data: members = [] } = useProjectMembers(projectId)
  const profiles = members.flatMap((m) => (m.profile ? [m.profile] : []))
  const create = useCreateRelease()
  const update = useUpdateRelease()
  const pending = create.isPending || update.isPending

  const [values, setValues] = useState<ReleaseInput>(() =>
    release
      ? {
          project_id: release.project_id,
          sprint_id: release.sprint?.id ?? null,
          name: release.name,
          version: release.version,
          owner_id: release.owner?.id ?? null,
          planned_deployment_date: release.planned_deployment_date,
          description: release.description,
        }
      : {
          project_id: currentProject?.id ?? '',
          sprint_id: sprintsEnabled ? (defaultSprintId ?? currentSprint?.id ?? null) : null,
          name: '',
          version: '',
          owner_id: user?.id ?? null,
          planned_deployment_date: '',
          description: null,
        },
  )
  const [errors, setErrors] = useState<ReleaseFormErrors>({})
  const [override, setOverride] = useState<ReleaseStatus | null>(release?.status_override ?? null)
  const [overrideReason, setOverrideReason] = useState(release?.status_override_reason ?? '')
  const sprint = sprints.find((s) => s.id === values.sprint_id)

  function set<K extends keyof ReleaseInput>(key: K, value: ReleaseInput[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next = validateRelease(values)
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const input = normalizeRelease(values)
    try {
      if (release) {
        // A release never moves between projects.
        const { project_id: _project, ...editable } = input
        await update.mutateAsync({
          id: release.id,
          patch: {
            ...editable,
            status_override: override,
            status_override_reason: override ? overrideReason.trim() || null : null,
          },
        })
        toast.success(`${input.name} updated`)
        onDone()
      } else {
        const { id } = await create.mutateAsync(input)
        toast.success(`${input.name} created`)
        onDone()
        navigate(`/releases/${id}`)
      }
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>{release ? `Edit ${release.name}` : 'New release'}</DialogTitle>
        <DialogDescription>
          {release
            ? 'Workflow steps are not affected.'
            : `The project's ${currentProject?.enabled_steps.length ?? 12} workflow steps are created automatically as Not started.`}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Name" error={errors.name}>
          {(p) => (
            <Input {...p} autoFocus placeholder="RC_1" value={values.name} onChange={(e) => set('name', e.target.value)} />
          )}
        </FormField>
        <FormField label="Version" error={errors.version}>
          {(p) => (
            <Input
              {...p}
              placeholder="1.4.0"
              className="font-mono"
              value={values.version}
              onChange={(e) => set('version', e.target.value)}
            />
          )}
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {sprintsEnabled && (
          <FormField label="Sprint" error={errors.sprint_id}>
            {(p) => (
              <Select
                value={values.sprint_id ?? NO_SPRINT}
                onValueChange={(v) => set('sprint_id', v === NO_SPRINT ? null : v)}
              >
                <SelectTrigger {...p} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SPRINT}>No sprint</SelectItem>
                  {sprints.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        )}
        <FormField label="Owner">
          {(p) => (
            <Select
              value={values.owner_id ?? UNASSIGNED}
              onValueChange={(v) => set('owner_id', v === UNASSIGNED ? null : v)}
            >
              <SelectTrigger {...p} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>

      <FormField
        label="Target deployment date"
        error={errors.planned_deployment_date}
        hint={
          sprint &&
          (targetOutsideSprint(values.planned_deployment_date, sprint) ? (
            <span className="text-amber-700 dark:text-amber-400">
              Outside {sprint.name} ({formatDayRange(sprint.start_date, sprint.end_date)}).
            </span>
          ) : (
            `${sprint.name}: ${formatDayRange(sprint.start_date, sprint.end_date)}`
          ))
        }
      >
        {(p) => (
          <Input
            {...p}
            type="date"
            value={values.planned_deployment_date}
            onChange={(e) => set('planned_deployment_date', e.target.value)}
          />
        )}
      </FormField>

      <FormField label="Description" error={errors.description}>
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            placeholder="Scope, notable changes…"
            value={values.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        )}
      </FormField>

      {release && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-dashed p-3">
          <FormField label="Status" hint={override ? 'Overrides the calculated status.' : 'Calculated from the workflow.'}>
            {(p) => (
              <Select
                value={override ?? AUTOMATIC}
                onValueChange={(v) => setOverride(v === AUTOMATIC ? null : (v as ReleaseStatus))}
              >
                <SelectTrigger {...p} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
                  {OVERRIDE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {RELEASE_STATUS_LABELS[s]} (manual)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {override && (
            <FormField label="Override reason">
              {(p) => (
                <Input
                  {...p}
                  placeholder="Why is the status overridden?"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              )}
            </FormField>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : release ? 'Save' : 'Create release'}
        </Button>
      </DialogFooter>
    </form>
  )
}
