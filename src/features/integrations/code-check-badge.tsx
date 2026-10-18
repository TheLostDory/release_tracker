import { Link } from 'react-router'
import { CircleCheck, CircleHelp, GitCompareArrows, TriangleAlert } from 'lucide-react'
import { codeCheckState, type CodeCheckCounts } from '@/lib/code-check'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'

/** The release's latest "Code vs Jira" result as a small badge linking to the comparison. */
export function CodeCheckBadge({ releaseId, check }: { releaseId: string; check: (CodeCheckCounts & { checked_at: string }) | null | undefined }) {
  const state = codeCheckState(check)
  const when = check ? ` · checked ${formatTimestamp(check.checked_at)}` : ''
  const look =
    state.kind === 'match'
      ? { icon: CircleCheck, text: 'Matches', title: `What was merged matches Jira${when}`, className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
      : state.kind === 'differs'
        ? { icon: TriangleAlert, text: `${state.differences} difference${state.differences === 1 ? '' : 's'}`, title: `${state.parts.join(' · ')}${when}`, className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' }
        : state.kind === 'error'
          ? { icon: TriangleAlert, text: 'Check failed', title: state.message, className: 'bg-red-500/10 text-red-700 dark:text-red-400' }
          : state.kind === 'no_jira'
            ? { icon: CircleHelp, text: 'No Jira version', title: 'Link the release to its Jira version to compare', className: 'bg-muted text-muted-foreground' }
            : { icon: GitCompareArrows, text: 'Not checked', title: 'Open to compare the RC with Jira', className: 'bg-muted text-muted-foreground' }
  const Icon = look.icon
  return (
    <Link
      to={`/releases/${releaseId}/compare`}
      title={look.title}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap hover:underline', look.className)}
    >
      <Icon className="size-3.5" aria-hidden />
      {look.text}
    </Link>
  )
}
