import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { Button } from '@/components/ui/button'
import { toUserMessage } from '@/lib/errors'
import type { ReleaseDetail } from './api'
import { useDeleteRelease } from './queries'
import { ReleaseDialog } from './release-dialog'

export function ReleaseActions({ release, canDelete }: { release: ReleaseDetail; canDelete: boolean }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const remove = useDeleteRelease()

  function confirmDelete() {
    remove.mutate(release.id, {
      onSuccess: () => {
        toast.success(`${release.name} deleted`)
        navigate(release.sprint ? `/sprints/${release.sprint.id}` : '/releases', { replace: true })
      },
      onError: (err) => toast.error(toUserMessage(err)),
    })
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <Pencil />
        Edit
      </Button>
      {canDelete && (
        <Button size="sm" variant="ghost" onClick={() => setDeleting(true)} aria-label={`Delete ${release.name}`}>
          <Trash2 />
        </Button>
      )}

      <ReleaseDialog open={editing} onOpenChange={setEditing} release={release} />
      <ConfirmDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${release.name} (${release.version})?`}
        description="This permanently deletes the release with its workflow steps, reports, approval and activity history."
        confirmLabel="Delete release"
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  )
}
