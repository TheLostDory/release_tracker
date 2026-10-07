import { useMemo, useState } from 'react'
import { QueryError } from '@/components/query-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ActionItemList } from '@/features/attention/action-item-list'
import { useActionItems } from '@/features/attention/use-action-items'
import { useAuth } from '@/features/auth/auth-context'
import { useProfiles } from '@/features/profiles/queries'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'release-tracker:action-scope'

type Scope = 'all' | 'mine'

function readScope(): Scope {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'mine' ? 'mine' : 'all'
  } catch {
    return 'all'
  }
}

export function ActionRequired() {
  const { user } = useAuth()
  const { items, isLoading, error, refetch } = useActionItems()
  const { data: profiles = [] } = useProfiles()
  const [scope, setScopeState] = useState<Scope>(readScope)
  const ownerNames = useMemo(() => new Map(profiles.map((p) => [p.id, p.name])), [profiles])
  const mine = useMemo(() => items.filter((i) => i.assigneeId === user?.id), [items, user?.id])
  const visible = scope === 'mine' ? mine : items

  function setScope(next: Scope) {
    setScopeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Preference just won't persist.
    }
  }

  return (
    <section aria-labelledby="action-required-heading" className="rounded-lg border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 id="action-required-heading" className="text-sm font-semibold">
          Action required
          {!isLoading && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{visible.length}</span>}
        </h2>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Show actions for">
          {(['all', 'mine'] as const).map((s) => (
            <Button
              key={s}
              size="xs"
              variant="ghost"
              aria-pressed={scope === s}
              className={cn('h-6 px-2 capitalize', scope === s && 'bg-muted')}
              onClick={() => setScope(s)}
            >
              {s === 'mine' ? `Mine (${mine.length})` : 'All'}
            </Button>
          ))}
        </div>
      </header>
      {isLoading ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="p-3">
          <QueryError error={error} onRetry={() => void refetch()} />
        </div>
      ) : (
        <ActionItemList
          items={visible}
          ownerNames={ownerNames}
          emptyLabel={scope === 'mine' ? 'Nothing assigned to you needs attention.' : 'Nothing needs attention.'}
        />
      )}
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">All open releases, across sprints.</p>
    </section>
  )
}
