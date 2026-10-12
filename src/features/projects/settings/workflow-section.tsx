import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { toUserMessage } from '@/lib/supabase-errors'
import { cn } from '@/lib/utils'
import { REPORT_LABELS, REPORT_TYPES, REQUIRED_STEPS, REVIEW_STEP_FOR_REPORT, WORKFLOW_STEPS } from '@/lib/workflow'
import type { WorkflowTaskType } from '@/types/domain'
import type { Project } from '../api'
import { useUpdateProject } from '../queries'
import { SettingsSection } from './settings-section'

const REVIEW_STEPS = new Set<WorkflowTaskType>(Object.values(REVIEW_STEP_FOR_REPORT))
/** Steps shown in the "Steps" group (reports and approval have their own). */
const GENERAL_STEPS = WORKFLOW_STEPS.filter((s) => !REVIEW_STEPS.has(s.type) && s.type !== 'APPROVAL')

export function WorkflowSection({ project, canManage }: { project: Project; canManage: boolean }) {
  return <WorkflowForm key={`${project.id}:${project.enabled_steps.join()}`} project={project} canManage={canManage} />
}

function WorkflowForm({ project, canManage }: { project: Project; canManage: boolean }) {
  const [steps, setSteps] = useState(() => new Set(project.enabled_steps))
  const update = useUpdateProject()
  const dirty =
    steps.size !== project.enabled_steps.length || project.enabled_steps.some((s) => !steps.has(s))

  function toggle(type: WorkflowTaskType, on: boolean) {
    setSteps((prev) => {
      const next = new Set(prev)
      if (on) next.add(type)
      else next.delete(type)
      return next
    })
  }

  async function save() {
    // Keep workflow order so the stored array reads naturally.
    const enabled = WORKFLOW_STEPS.map((s) => s.type).filter((t) => steps.has(t))
    try {
      await update.mutateAsync({ id: project.id, patch: { enabled_steps: enabled } })
      toast.success('Workflow updated. New releases will use it.')
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <SettingsSection
      title="Workflow"
      description="Applies to releases created from now on. Existing releases keep their steps."
    >
      <div className="grid gap-6 md:grid-cols-3">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-muted-foreground">Steps</legend>
          {GENERAL_STEPS.map((s) => {
            const required = REQUIRED_STEPS.includes(s.type)
            return (
              <Check
                key={s.type}
                label={s.name}
                hint={required ? 'Always on' : undefined}
                checked={steps.has(s.type)}
                disabled={!canManage || required}
                onChange={(on) => toggle(s.type, on)}
              />
            )
          })}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-muted-foreground">Reports to review</legend>
          {REPORT_TYPES.map((r) => (
            <Check
              key={r}
              label={`${REPORT_LABELS[r]} report`}
              checked={steps.has(REVIEW_STEP_FOR_REPORT[r])}
              disabled={!canManage}
              onChange={(on) => toggle(REVIEW_STEP_FOR_REPORT[r], on)}
            />
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-muted-foreground">Approval</legend>
          <Check
            label="Approval required"
            hint="Releases wait for a recorded approval before deployment."
            checked={steps.has('APPROVAL')}
            disabled={!canManage}
            onChange={(on) => toggle('APPROVAL', on)}
          />
        </fieldset>
      </div>
      {canManage && (
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => void save()} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save workflow'}
          </Button>
          <span className="text-xs text-muted-foreground">{steps.size} of {WORKFLOW_STEPS.length} steps</span>
        </div>
      )}
    </SettingsSection>
  )
}

function Check({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={cn('flex items-start gap-2 text-sm', disabled && 'cursor-not-allowed text-muted-foreground')}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-foreground"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}
