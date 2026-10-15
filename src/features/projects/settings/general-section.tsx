import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toUserMessage } from '@/lib/errors'
import type { Project } from '../api'
import { useUpdateProject } from '../queries'
import { SettingsSection } from './settings-section'

export function GeneralSection({ project, canManage }: { project: Project; canManage: boolean }) {
  // Remount when the saved values change (e.g. after switching projects).
  return (
    <GeneralForm
      key={`${project.id}:${project.name}:${project.description}:${project.sprints_enabled}`}
      project={project}
      canManage={canManage}
    />
  )
}

function GeneralForm({ project, canManage }: { project: Project; canManage: boolean }) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [sprintsEnabled, setSprintsEnabled] = useState(project.sprints_enabled)
  const [error, setError] = useState<string>()
  const update = useUpdateProject()
  const dirty =
    name.trim() !== project.name || (description.trim() || null) !== project.description || sprintsEnabled !== project.sprints_enabled

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Name is required.')
    if (trimmed.length > 100) return setError('Keep it under 100 characters.')
    try {
      await update.mutateAsync({
        id: project.id,
        patch: { name: trimmed, description: description.trim() || null, sprints_enabled: sprintsEnabled },
      })
      toast.success('Project updated')
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <SettingsSection title="General" description={canManage ? undefined : 'Only admins and owners can change these.'}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Name" error={error}>
          {(p) => (
            <Input
              {...p}
              value={name}
              disabled={!canManage}
              onChange={(e) => {
                setName(e.target.value)
                setError(undefined)
              }}
            />
          )}
        </FormField>
        <FormField label="Description">
          {(p) => (
            <Textarea {...p} rows={2} value={description} disabled={!canManage} onChange={(e) => setDescription(e.target.value)} />
          )}
        </FormField>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-foreground"
            checked={sprintsEnabled}
            disabled={!canManage}
            onChange={(e) => setSprintsEnabled(e.target.checked)}
          />
          <span>
            Use sprints
            <span className="block text-xs text-muted-foreground">
              Turning sprints off hides them everywhere; existing sprints and their links are kept.
            </span>
          </span>
        </label>
        {canManage && (
          <Button type="submit" size="sm" disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </form>
    </SettingsSection>
  )
}
