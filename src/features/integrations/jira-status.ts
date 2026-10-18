import type { JiraIssue } from './api'

/** Jira's status categories, as badges. */
export const CATEGORY: Record<JiraIssue['statusCategory'], { label: string; className: string }> = {
  new: { label: 'To do', className: 'bg-muted text-muted-foreground' },
  indeterminate: { label: 'In progress', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  done: { label: 'Done', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  unknown: { label: 'Other', className: 'bg-muted text-muted-foreground' },
}
