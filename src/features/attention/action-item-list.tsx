import { Link } from 'react-router'
import { CircleCheck } from 'lucide-react'
import { usePrefetchRelease } from '@/features/releases/queries'
import type { ActionItem, ActionSeverity } from '@/lib/action-items'
import { ACTION_KIND_ICONS } from '@/lib/status-icons'
import { cn } from '@/lib/utils'

const SEVERITY_ICON_CLASS: Record<ActionSeverity, string> = {
  critical: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground',
}

const SEVERITY_LABEL: Record<ActionSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
}

interface Props {
  items: readonly ActionItem[]
  ownerNames?: ReadonlyMap<string, string>
  emptyLabel?: string
  onNavigate?: () => void
  dense?: boolean
}

export function ActionItemList({ items, ownerNames, emptyLabel = 'Nothing needs attention.', onNavigate, dense }: Props) {
  const prefetch = usePrefetchRelease()
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
        <CircleCheck className="size-4 text-emerald-600" aria-hidden />
        {emptyLabel}
      </p>
    )
  }

  return (
    <ul className="divide-y">
      {items.map((item) => {
        const Icon = ACTION_KIND_ICONS[item.kind]
        const assignee = item.assigneeId ? ownerNames?.get(item.assigneeId) : undefined
        return (
          <li key={item.id}>
            <Link
              to={`/releases/${item.releaseId}`}
              onClick={onNavigate}
              onMouseEnter={() => prefetch(item.releaseId)}
              onFocus={() => prefetch(item.releaseId)}
              className={cn(
                'flex gap-2.5 px-3 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
                dense ? 'py-2' : 'py-2.5',
              )}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', SEVERITY_ICON_CLASS[item.severity])} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  <span className="font-medium">{item.releaseName}</span>
                  <span className="text-muted-foreground"> — </span>
                  {item.title}
                </span>
                {(item.detail || assignee) && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {[item.detail, assignee].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className="sr-only">{SEVERITY_LABEL[item.severity]}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
