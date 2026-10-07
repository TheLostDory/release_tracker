import { useMemo, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ActionItemList } from '@/features/attention/action-item-list'
import { useActionItems } from '@/features/attention/use-action-items'
import { useProfiles } from '@/features/profiles/queries'
import { cn } from '@/lib/utils'

/** In-app notifications: the same action items as the dashboard. */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const { items, isLoading } = useActionItems()
  const { data: profiles = [] } = useProfiles()
  const ownerNames = useMemo(() => new Map(profiles.map((p) => [p.id, p.name])), [profiles])
  const critical = items.filter((i) => i.severity === 'critical').length
  const count = items.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={count ? `Notifications: ${count} items need attention${critical ? `, ${critical} critical` : ''}` : 'Notifications'}
        >
          <Bell />
          {!isLoading && count > 0 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums text-white',
                critical ? 'bg-red-600' : 'bg-foreground/70',
              )}
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-3 py-2 text-sm font-semibold">Needs attention</div>
        <div className="max-h-96 overflow-y-auto">
          <ActionItemList items={items} ownerNames={ownerNames} onNavigate={() => setOpen(false)} dense />
        </div>
      </PopoverContent>
    </Popover>
  )
}
