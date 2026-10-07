import { useCallback, useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
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
import type { WorkflowStep } from '@/lib/workflow'

interface Pending {
  stepName: string
  unmet: WorkflowStep[]
  proceed: () => void
}

/**
 * Soft dependency rules: run the action directly when prerequisites are met,
 * otherwise ask for confirmation listing what is being bypassed.
 */
export function useDependencyGuard(): [
  (stepName: string, unmet: WorkflowStep[], proceed: () => void) => void,
  ReactNode,
] {
  const [pending, setPending] = useState<Pending | null>(null)

  const guard = useCallback((stepName: string, unmet: WorkflowStep[], proceed: () => void) => {
    if (unmet.length === 0) proceed()
    else setPending({ stepName, unmet, proceed })
  }, [])

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-600" />
            Bypass workflow order?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-medium text-foreground">{pending?.stepName}</span> normally comes after:
              </p>
              <ul className="list-disc pl-5">
                {pending?.unmet.map((s) => <li key={s.type}>{s.name}</li>)}
              </ul>
              <p>These are not completed or skipped yet. The bypass will be visible in the activity log.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              pending?.proceed()
              setPending(null)
            }}
          >
            Continue anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return [guard, dialog]
}
