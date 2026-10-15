import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-context'
import { toUserMessage } from '@/lib/errors'
import type { Project } from '../api'
import { useDeleteProject, useRemoveMember } from '../queries'
import { SettingsSection } from './settings-section'

export function DangerSection({ project }: { project: Project }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const leave = useRemoveMember(project.id)
  const remove = useDeleteProject()
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')

  return (
    <SettingsSection title="Danger zone" tone="danger">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">Leave project</div>
            <div className="text-muted-foreground">You'll lose access until someone invites you again.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setConfirmLeave(true)}>
            Leave
          </Button>
        </div>
        {project.role === 'OWNER' && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm">
              <div className="font-medium">Delete project</div>
              <div className="text-muted-foreground">Permanently deletes all its sprints, releases, reports and history.</div>
            </div>
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              Delete project
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              If you're the only owner, promote someone else first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (!user) return
                leave.mutate(user.id, {
                  onSuccess: () => {
                    toast.success(`You left ${project.name}`)
                    navigate('/')
                  },
                  onError: (err) => {
                    toast.error(toUserMessage(err))
                    setConfirmLeave(false)
                  },
                })
              }}
            >
              Leave project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open)
          if (!open) setTyped('')
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project and everything in it, for every member. It cannot be undone. Type the
              project name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={project.name} aria-label="Project name" autoFocus />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={typed !== project.name || remove.isPending}
              onClick={(e) => {
                e.preventDefault()
                remove.mutate(project.id, {
                  onSuccess: () => {
                    toast.success(`${project.name} deleted`)
                    navigate('/')
                  },
                  onError: (err) => toast.error(toUserMessage(err)),
                })
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete forever'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
