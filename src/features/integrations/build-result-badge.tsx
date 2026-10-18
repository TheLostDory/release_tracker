import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { JenkinsBuild } from './api'

export function BuildResultBadge({ build }: { build: Pick<JenkinsBuild, 'building' | 'result'> | null }) {
  if (!build) return <Badge variant="secondary" className="font-normal">No builds</Badge>
  if (build.building) {
    return (
      <Badge className="bg-blue-500/10 font-normal text-blue-700 dark:text-blue-400">
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden /> Running
      </Badge>
    )
  }
  const tone: Record<string, string> = {
    SUCCESS: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    FAILURE: 'bg-red-500/10 text-red-700 dark:text-red-400',
    UNSTABLE: 'bg-amber-500/15 text-amber-800 dark:text-amber-400',
  }
  const result = build.result ?? 'UNKNOWN'
  return <Badge className={cn('font-normal', tone[result] ?? 'bg-muted text-muted-foreground')}>{result.charAt(0) + result.slice(1).toLowerCase()}</Badge>
}
