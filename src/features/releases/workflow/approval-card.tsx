import { Check, RotateCcw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { unmetDependencies, type WorkflowStep } from '@/lib/workflow'
import type { ApprovalStatus } from '@/types/domain'
import type { ApprovalPatch, ReleaseApproval, ReleaseTask } from '../api'
import { managedCardId } from './card-ids'

const STATUS_BADGE: Record<ApprovalStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
  APPROVED: { label: 'Approved', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  REJECTED: { label: 'Rejected', className: 'bg-red-500/10 text-red-700 dark:text-red-400' },
}

interface Props {
  approval: ReleaseApproval
  tasks: readonly ReleaseTask[]
  onUpdate: (id: string, patch: ApprovalPatch) => void
  guard: (stepName: string, unmet: WorkflowStep[], proceed: () => void) => void
  readOnly?: boolean
}

export function ApprovalCard({ approval, tasks, onUpdate, guard, readOnly = false }: Props) {
  const badge = STATUS_BADGE[approval.status]

  function setStatus(status: ApprovalStatus) {
    const apply = () => onUpdate(approval.id, { status })
    // Approval before escalation is allowed but must be explicit.
    if (status === 'APPROVED') guard('Approval', unmetDependencies('APPROVAL', tasks), apply)
    else apply()
  }

  return (
    <section
      id={managedCardId('APPROVAL')}
      tabIndex={-1}
      aria-label="Approval"
      className="flex flex-col gap-3 rounded-lg border p-3 transition-shadow outline-none"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Approval</h3>
        <Badge className={cn('font-medium', badge.className)}>{badge.label}</Badge>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Requested</dt>
          <dd>{approval.requested_at ? formatTimestamp(approval.requested_at) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{approval.status === 'REJECTED' ? 'Rejected' : 'Approved'}</dt>
          <dd>
            {approval.approved_at
              ? `${approval.approver?.name ?? 'unknown'} · ${formatTimestamp(approval.approved_at)}`
              : '—'}
          </dd>
        </div>
      </dl>

      <Textarea
        key={`comments-${approval.comments}`}
        aria-label="Approval comments"
        placeholder={readOnly ? 'No comments' : 'Comments, conditions, approver…'}
        readOnly={readOnly}
        rows={2}
        defaultValue={approval.comments ?? ''}
        className="text-sm"
        onBlur={(e) => {
          const value = e.target.value.trim() || null
          if (value !== approval.comments) onUpdate(approval.id, { comments: value })
        }}
      />

      <div className={readOnly ? 'hidden' : 'mt-auto flex gap-2'}>
        {approval.status === 'PENDING' ? (
          <>
            <Button size="sm" className="flex-1" onClick={() => setStatus('APPROVED')}>
              <Check />
              Record approval
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStatus('REJECTED')}>
              <X />
              Reject
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setStatus('PENDING')}>
            <RotateCcw />
            Reset to pending
          </Button>
        )}
      </div>
    </section>
  )
}
