import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { Button } from '@/components/ui/button'
import { formatDay } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { usePlanDates } from './queries'

/** Re-plans the open steps' dates from the target deployment date. */
export function PlanDatesButton({ releaseId, target }: { releaseId: string; target: string }) {
  const [open, setOpen] = useState(false)
  const plan = usePlanDates(releaseId)
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <CalendarClock />
        Plan dates
      </Button>
      <ConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Plan the dates of open steps?"
        description={`Each open step gets its date counted back from the target (${formatDay(target, 'EEE, MMM d')}), using the project's automation settings. Dates you changed by hand are replaced; finished steps keep theirs.`}
        confirmLabel="Plan dates"
        tone="default"
        pending={plan.isPending}
        onConfirm={() =>
          plan.mutate(undefined, {
            onSuccess: (r) => {
              setOpen(false)
              toast.success(r.changed ? `${r.changed} step date${r.changed === 1 ? '' : 's'} planned` : 'Dates were already planned')
            },
            onError: (err) => toast.error(toUserMessage(err)),
          })
        }
      />
    </>
  )
}
