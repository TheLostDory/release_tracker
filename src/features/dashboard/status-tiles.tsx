import { Layers } from 'lucide-react'
import { RELEASE_STATUS_ICONS } from '@/lib/status-icons'
import { RELEASE_STATUS_LABELS } from '@/lib/status-labels'
import { ATTENTION_SURFACE } from '@/lib/attention-styles'
import { cn } from '@/lib/utils'
import type { ReleaseStatus } from '@/types/domain'

const ORDER: ReleaseStatus[] = ['ON_TRACK', 'AT_RISK', 'BLOCKED', 'WAITING_FOR_APPROVAL', 'RELEASED']

const ICON_CLASS: Record<ReleaseStatus, string> = {
  ON_TRACK: 'text-emerald-600 dark:text-emerald-400',
  AT_RISK: 'text-amber-600 dark:text-amber-400',
  BLOCKED: 'text-red-600 dark:text-red-400',
  WAITING_FOR_APPROVAL: 'text-violet-600 dark:text-violet-400',
  RELEASED: 'text-muted-foreground',
}

interface Props {
  counts: Record<ReleaseStatus, number>
  total: number
  selected: ReleaseStatus | null
  onSelect: (status: ReleaseStatus | null) => void
}

/** KPI row; each tile filters the release cards below. */
export function StatusTiles({ counts, total, selected, onSelect }: Props) {
  const tiles = [
    { key: null, label: 'Total releases', value: total, Icon: Layers, iconClass: 'text-muted-foreground' },
    ...ORDER.map((s) => ({
      key: s,
      label: RELEASE_STATUS_LABELS[s],
      value: counts[s],
      Icon: RELEASE_STATUS_ICONS[s],
      iconClass: ICON_CLASS[s],
    })),
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Filter releases by status">
      {tiles.map(({ key, label, value, Icon, iconClass }) => {
        const active = selected === key
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active || key === null ? null : key)}
            className={cn(
              'rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              active && 'border-foreground/40 bg-muted/60',
              value === 0 && key !== null && !active && 'opacity-60',
              value > 0 && key !== null && ATTENTION_SURFACE[key],
            )}
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className={cn('size-3.5', iconClass)} aria-hidden />
              {label}
            </span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums">{value}</span>
          </button>
        )
      })}
    </div>
  )
}
