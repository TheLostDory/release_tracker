import { useState } from 'react'
import { UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/auth-context'
import { assignableRoles, ROLE_DESCRIPTIONS, ROLE_LABELS, type ProjectRole } from '@/lib/permissions'
import { toUserMessage } from '@/lib/errors'
import type { Project, ProjectMember } from '../api'
import { useProjectMembers, useRemoveMember, useSetMemberRole } from '../queries'
import { SettingsSection } from './settings-section'

export function MembersSection({ project }: { project: Project }) {
  const { user } = useAuth()
  const { data: members, isLoading } = useProjectMembers(project.id)
  const setRole = useSetMemberRole(project.id)
  const remove = useRemoveMember(project.id)
  const [removing, setRemoving] = useState<ProjectMember | null>(null)

  function changeRole(member: ProjectMember, role: ProjectRole) {
    setRole.mutate(
      { userId: member.user_id, role },
      {
        onSuccess: () => toast.success(`${member.profile?.name ?? 'Member'} is now ${ROLE_LABELS[role].toLowerCase()}`),
        onError: (err) => toast.error(toUserMessage(err)),
      },
    )
  }

  return (
    <SettingsSection title="Members" description={members ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : undefined}>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="divide-y rounded-md border">
          {(members ?? []).map((m) => {
            const isMe = m.user_id === user?.id
            const roles = assignableRoles(project.role, m.role)
            const canRemove = !isMe && roles.length > 0
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.profile?.name ?? 'Unknown'}
                    {isMe && <span className="ml-1.5 font-normal text-muted-foreground">(you)</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.profile?.email}</div>
                </div>
                {roles.length > 0 ? (
                  <Select value={m.role} onValueChange={(v) => changeRole(m, v as ProjectRole)}>
                    <SelectTrigger size="sm" className="w-32" aria-label={`Role of ${m.profile?.name ?? 'member'}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r} value={r}>
                          <span>{ROLE_LABELS[r]}</span>
                          <span className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary" className="font-normal">
                    {ROLE_LABELS[m.role]}
                  </Badge>
                )}
                {canRemove && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${m.profile?.name ?? 'member'}`}
                    onClick={() => setRemoving(m)}
                  >
                    <UserMinus />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDeleteDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.profile?.name ?? 'member'}?`}
        description={`They will lose access to ${project.name} immediately. Their past activity stays in the log.`}
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.user_id, {
            onSuccess: () => {
              toast.success(`${removing.profile?.name ?? 'Member'} removed`)
              setRemoving(null)
            },
            onError: (err) => toast.error(toUserMessage(err)),
          })
        }
      />
    </SettingsSection>
  )
}
