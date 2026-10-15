import { useState } from 'react'
import { useNavigate } from 'react-router'
import { MoreHorizontal, Pencil, Play, CheckCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toUserMessage } from '@/lib/errors'
import type { SprintStatus, SprintWithCount } from '@/types/domain'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { useDeleteSprint, useUpdateSprint } from './queries'
import { SprintDialog } from './sprint-dialog'

interface Props {
  sprint: SprintWithCount
  /** Where to go after deleting (detail page leaves; list page stays). */
  afterDelete?: string
}

export function SprintActions({ sprint, afterDelete }: Props) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { currentProject, permissions } = useCurrentProject()
  const update = useUpdateSprint(currentProject?.id ?? '')
  const remove = useDeleteSprint()

  function setStatus(status: SprintStatus) {
    update.mutate(
      { id: sprint.id, patch: { status } },
      { onError: (err) => toast.error(toUserMessage(err)) },
    )
  }

  function confirmDelete() {
    remove.mutate(sprint.id, {
      onSuccess: () => {
        toast.success(`${sprint.name} deleted`)
        setDeleting(false)
        if (afterDelete) navigate(afterDelete)
      },
      onError: (err) => toast.error(toUserMessage(err)),
    })
  }

  const hasReleases = sprint.release_count > 0
  if (!permissions.canEdit) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${sprint.name}`} onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          {sprint.status !== 'ACTIVE' && (
            <DropdownMenuItem onSelect={() => setStatus('ACTIVE')}>
              <Play />
              Mark active
            </DropdownMenuItem>
          )}
          {sprint.status !== 'COMPLETED' && (
            <DropdownMenuItem onSelect={() => setStatus('COMPLETED')}>
              <CheckCheck />
              Mark completed
            </DropdownMenuItem>
          )}
          {permissions.canDelete && <DropdownMenuSeparator />}
          {permissions.canDelete && (
          <DropdownMenuItem
            variant="destructive"
            disabled={hasReleases}
            onSelect={() => setDeleting(true)}
            title={hasReleases ? 'Move or delete its releases first' : undefined}
          >
            <Trash2 />
            {hasReleases ? 'Delete (has releases)' : 'Delete'}
          </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SprintDialog open={editing} onOpenChange={setEditing} sprint={sprint} />
      <ConfirmDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${sprint.name}?`}
        description="This sprint has no releases. This cannot be undone."
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  )
}
