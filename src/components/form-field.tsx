import { useId, type ReactElement, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'

interface ControlProps {
  id: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

interface Props {
  label: string
  error?: string
  hint?: ReactNode
  /** Render prop so the control gets the id / aria wiring. */
  children: (props: ControlProps) => ReactElement
  className?: string
}

export function FormField({ label, error, hint, children, className }: Props) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint
  return (
    <div className={className ?? 'space-y-1.5'}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': message ? messageId : undefined,
      })}
      {message && (
        <p id={messageId} className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {message}
        </p>
      )}
    </div>
  )
}
