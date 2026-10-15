import { useState, type FormEvent } from 'react'
import { Check, Copy, Link2, Mail, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToday } from '@/hooks/use-today'
import { formatTimestamp } from '@/lib/dates'
import { assignableRoles, ROLE_LABELS, type ProjectRole } from '@/lib/permissions'
import { toUserMessage } from '@/lib/errors'
import type { Project } from '../api'
import { useCreateInviteLink, useInviteByEmail, usePendingInvitations, useRevokeInvitation } from '../queries'
import { SettingsSection } from './settings-section'

const EXPIRY_OPTIONS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

function RoleSelect({ value, onChange, roles, label }: { value: ProjectRole; onChange: (r: ProjectRole) => void; roles: ProjectRole[]; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ProjectRole)}>
      <SelectTrigger size="sm" className="w-28" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function InvitationsSection({ project }: { project: Project }) {
  const roles = assignableRoles(project.role, null)
  return (
    <SettingsSection title="Invite people" description="Admins and owners can invite. Invitations never grant the owner role; promote members afterwards.">
      <div className="grid gap-6 lg:grid-cols-2">
        <EmailInvite project={project} roles={roles} />
        <LinkInvite project={project} roles={roles} />
      </div>
      <PendingInvitations project={project} />
    </SettingsSection>
  )
}

function EmailInvite({ project, roles }: { project: Project; roles: ProjectRole[] }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProjectRole>('MEMBER')
  const invite = useInviteByEmail(project.id)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!value) return
    try {
      const result = await invite.mutateAsync({ email: value, role })
      toast.success(
        result === 'added'
          ? `${value} added as ${ROLE_LABELS[role].toLowerCase()}`
          : `Invitation saved. ${value} joins automatically when their account is created.`,
      )
      setEmail('')
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Mail className="size-3.5" /> By email
      </h3>
      <div className="flex gap-2">
        <Input
          type="email"
          required
          placeholder="name@company.com"
          aria-label="Email to invite"
          className="h-8"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <RoleSelect value={role} onChange={setRole} roles={roles} label="Role for email invite" />
        <Button type="submit" size="sm" disabled={invite.isPending || !email.trim()}>
          Invite
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Existing users are added right away. Others join when their account is created.</p>
    </form>
  )
}

function LinkInvite({ project, roles }: { project: Project; roles: ProjectRole[] }) {
  const [role, setRole] = useState<ProjectRole>('MEMBER')
  const [days, setDays] = useState(7)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const create = useCreateInviteLink(project.id)

  async function generate() {
    try {
      const token = await create.mutateAsync({ role, days })
      setLink(`${window.location.origin}/invite/${token}`)
      setCopied(false)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.')
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Link2 className="size-3.5" /> By link
      </h3>
      <div className="flex flex-wrap gap-2">
        <RoleSelect value={role} onChange={setRole} roles={roles} label="Role for invite link" />
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger size="sm" className="w-28" aria-label="Link expiry">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.map((o) => (
              <SelectItem key={o.days} value={String(o.days)}>
                Expires in {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => void generate()} disabled={create.isPending}>
          Create link
        </Button>
      </div>
      {link ? (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Input readOnly value={link} aria-label="Invite link" className="h-8 font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="outline" onClick={() => void copy()} aria-label="Copy invite link">
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300">Copy it now: for security it can't be shown again. Revoke it below anytime.</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Anyone with the link and an account can join until it expires or is revoked.</p>
      )}
    </div>
  )
}

function PendingInvitations({ project }: { project: Project }) {
  const { data: invitations = [] } = usePendingInvitations(project.id)
  const revoke = useRevokeInvitation()
  // Display filter only; the database refuses expired links regardless.
  const today = useToday()
  const active = invitations.filter((i) => !i.expires_at || i.expires_at.slice(0, 10) >= today)
  if (active.length === 0) return null

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Pending ({active.length})</h3>
      <ul className="divide-y rounded-md border text-sm">
        {active.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            {i.email ? <Mail className="size-4 text-muted-foreground" /> : <Link2 className="size-4 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">
              {i.email ?? `Invite link · used ${i.use_count} time${i.use_count === 1 ? '' : 's'}`}
            </span>
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[i.role]}</span>
            <span className="text-xs text-muted-foreground">
              {i.expires_at ? `expires ${formatTimestamp(i.expires_at, 'MMM d')}` : `sent ${formatTimestamp(i.created_at, 'MMM d')}`}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Revoke invitation"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate(i.id, {
                  onSuccess: () => toast.success('Invitation revoked'),
                  onError: (err) => toast.error(toUserMessage(err)),
                })
              }
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
