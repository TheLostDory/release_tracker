import type { ReleaseStatus } from '@/types/domain'

/** Surfaces (cards, rows, banners) for releases that need attention; calm states get none. */
export const ATTENTION_SURFACE: Partial<Record<ReleaseStatus, string>> = {
  AT_RISK: 'border-amber-500/60 bg-amber-500/5 dark:border-amber-400/50 dark:bg-amber-400/5',
  BLOCKED: 'border-red-500/60 bg-red-500/5 dark:border-red-400/50 dark:bg-red-400/5',
}

/** Reason text next to such a release. */
export const ATTENTION_TEXT: Partial<Record<ReleaseStatus, string>> = {
  AT_RISK: 'text-amber-800 dark:text-amber-300',
  BLOCKED: 'text-red-700 dark:text-red-400',
}

/** Left stripe on table rows. */
export const ATTENTION_STRIPE: Partial<Record<ReleaseStatus, string>> = {
  AT_RISK: 'shadow-[inset_3px_0_0_0_var(--color-amber-500)]',
  BLOCKED: 'shadow-[inset_3px_0_0_0_var(--color-red-600)]',
}
