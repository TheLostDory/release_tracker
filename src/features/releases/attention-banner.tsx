import { OctagonX, TriangleAlert } from 'lucide-react'
import { ATTENTION_SURFACE, ATTENTION_TEXT } from '@/lib/attention-styles'
import { cn } from '@/lib/utils'
import type { ReleaseStatus } from '@/types/domain'

const HEADLINE: Partial<Record<ReleaseStatus, string>> = {
  AT_RISK: 'This release is at risk',
  BLOCKED: 'This release is blocked',
}

/** Says plainly why a release needs attention (at risk / blocked), with every reason. */
export function AttentionBanner({ status, reasons, overridden }: { status: ReleaseStatus; reasons: readonly string[]; overridden: boolean }) {
  const headline = HEADLINE[status]
  if (!headline) return null
  const Icon = status === 'BLOCKED' ? OctagonX : TriangleAlert
  return (
    <div role="status" className={cn('flex gap-3 rounded-lg border p-4', ATTENTION_SURFACE[status])}>
      <Icon className={cn('mt-0.5 size-5 shrink-0', ATTENTION_TEXT[status])} aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className={cn('font-semibold', ATTENTION_TEXT[status])}>
          {headline}
          {overridden && <span className="ml-2 text-xs font-normal text-muted-foreground">(set manually)</span>}
        </p>
        {reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
