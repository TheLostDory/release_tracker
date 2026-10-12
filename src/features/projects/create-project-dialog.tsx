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
import { Textarea } from '@/components/ui/textarea'
import { toUserMessage } from '@/lib/supabase-errors'
import { useCurrentProject } from './current-project-context'
import { useCreateProject } from './queries'

export function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <CreateProjectForm onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function CreateProjectForm({ onDone }: { onDone: () => void }) {
  const { setCurrentProjectId } = useCurrentProject()
  const create = useCreateProject()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sprintsEnabled, setSprintsEnabled] = useState(true)
  const [error, setError] = useState<string>()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Name is required.')
    if (trimmed.length > 100) return setError('Keep it under 100 characters.')
    try {
      const id = await create.mutateAsync({ name: trimmed, description: description.trim() || null, sprintsEnabled })
      setCurrentProjectId(id)
      toast.success(`${trimmed} created. You're its owner.`)
      onDone()
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>You can change the workflow and invite people in project settings.</DialogDescription>
      </DialogHeader>
      <FormField label="Name" error={error}>
        {(p) => (
          <Input
            {...p}
            autoFocus
            placeholder="e.g. Payments platform"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(undefined)
            }}
          />
        )}
      </FormField>
      <FormField label="Description">
        {(p) => <Textarea {...p} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </FormField>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-foreground"
          checked={sprintsEnabled}
          onChange={(e) => setSprintsEnabled(e.target.checked)}
        />
        <span>
          Use sprints
          <span className="block text-xs text-muted-foreground">Group releases into time-boxed sprints. You can change this later.</span>
        </span>
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create project'}
        </Button>
      </DialogFooter>
    </form>
  )
}
