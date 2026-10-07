import { isRouteErrorResponse, useRouteError } from 'react-router'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** A deploy replaced the hashed chunks this tab still references. */
function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(message)
}

export default function RouteError({ inShell = false }: { inShell?: boolean }) {
  const error = useRouteError()
  const stale = isStaleChunkError(error)
  const message = stale
    ? 'A new version of Release Tracker was deployed. Reload to continue.'
    : isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : error instanceof Error
        ? error.message
        : 'Unexpected error'

  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 p-6 text-center', inShell ? 'py-16' : 'min-h-svh')}
    >
      {stale ? <RefreshCw className="size-6 text-muted-foreground" /> : <TriangleAlert className="size-6 text-amber-600" />}
      <p className="text-sm font-medium">{stale ? 'Update available' : 'Something went wrong'}</p>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  )
}
