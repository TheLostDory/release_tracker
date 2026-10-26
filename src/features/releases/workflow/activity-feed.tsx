import { History } from 'lucide-react'
import { QueryError } from '@/components/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestamp } from '@/lib/dates'
import { useReleaseActivity } from '../queries'

export function ActivityFeed({ releaseId }: { releaseId: string }) {
  const { data, isLoading, error, refetch } = useReleaseActivity(releaseId)

  if (isLoading) return <Skeleton className="h-32 w-full" />
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />
  if (!data?.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <History className="size-4" /> No activity yet.
      </p>
    )
  }

  return (
    <ol className="space-y-2.5 border-l pl-4">
      {data.map((entry) => (
        <li key={entry.id} className="relative text-sm">
          <span aria-hidden className="absolute top-1.5 -left-[21px] size-2 rounded-full border bg-background" />
          <time dateTime={entry.created_at} className="block text-xs text-muted-foreground tabular-nums">
            {formatTimestamp(entry.created_at)}
          </time>
          {(entry.action.startsWith('jenkins.') || entry.action.startsWith('automation.')) && !entry.user ? (
            // Background Jenkins sync / automation: the description says what happened.
            entry.description
          ) : (
            <>
              <span className="font-medium">{entry.user?.name ?? 'System'}</span> {entry.description}
            </>
          )}
        </li>
      ))}
    </ol>
  )
}
