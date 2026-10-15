import { useState, type FormEvent } from 'react'
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
import { SPRINT_STATUS_OPTIONS } from '@/lib/status-labels'
import { toUserMessage } from '@/lib/errors'
import type { Sprint, SprintStatus } from '@/types/domain'
import { useCurrentSprint } from './current-sprint-context'
import { useCreateSprint, useUpdateSprint } from './queries'
import { suggestNextSprint, validateSprint, type SprintFormErrors, type SprintFormValues } from './sprint-form'
import { useCurrentProject } from '@/features/projects/current-project-context'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this sprint; omit to create a new one. */
  sprint?: Sprint
}

export function SprintDialog({ open, onOpenChange, sprint }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remount the form on every open so it starts from fresh defaults. */}
        {open && <SprintForm sprint={sprint} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SprintForm({ sprint, onDone }: { sprint?: Sprint; onDone: () => void }) {
  const { sprints } = useCurrentSprint()
  const { currentProject } = useCurrentProject()
  const [values, setValues] = useState<SprintFormValues>(() =>
    sprint
      ? { name: sprint.name, start_date: sprint.start_date, end_date: sprint.end_date, status: sprint.status }
      : suggestNextSprint(sprints),
  )
  const [errors, setErrors] = useState<SprintFormErrors>({})
  const create = useCreateSprint()
  const update = useUpdateSprint(currentProject?.id ?? '')
  const pending = create.isPending || update.isPending

  function set<K extends keyof SprintFormValues>(key: K, value: SprintFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const next = validateSprint(values)
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const input = { ...values, name: values.name.trim() }
    try {
      if (sprint) {
        await update.mutateAsync({ id: sprint.id, patch: input })
        toast.success(`${input.name} updated`)
      } else {
        if (!currentProject) return
        await create.mutateAsync({ ...input, project_id: currentProject.id })
        toast.success(`${input.name} created`)
      }
      onDone()
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>{sprint ? 'Edit sprint' : 'New sprint'}</DialogTitle>
        <DialogDescription>
          {sprint ? 'Update the sprint name, dates or status.' : 'Pre-filled from the latest sprint.'}
        </DialogDescription>
      </DialogHeader>

      <FormField label="Name" error={errors.name}>
        {(p) => <Input {...p} autoFocus value={values.name} onChange={(e) => set('name', e.target.value)} />}
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Start date" error={errors.start_date}>
          {(p) => (
            <Input {...p} type="date" value={values.start_date} onChange={(e) => set('start_date', e.target.value)} />
          )}
        </FormField>
        <FormField label="End date" error={errors.end_date}>
          {(p) => (
            <Input
              {...p}
              type="date"
              min={values.start_date || undefined}
              value={values.end_date}
              onChange={(e) => set('end_date', e.target.value)}
            />
          )}
        </FormField>
      </div>

      <FormField label="Status">
        {(p) => (
          <Select value={values.status} onValueChange={(v) => set('status', v as SprintStatus)}>
            <SelectTrigger {...p} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPRINT_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : sprint ? 'Save' : 'Create sprint'}
        </Button>
      </DialogFooter>
    </form>
  )
}
