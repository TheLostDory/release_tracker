import type { FoundBug } from './api'

/** Closed bugs: Jira's done category, or a status saying so (Done, Dropped, Production Ready). */
export const isClosedBug = (b: FoundBug) => b.statusCategory === 'done' || /^(done|dropped|production ready)$/i.test(b.status.trim())

/** Open bugs first, closed ones at the end (each group in Jira's order). */
export const byStatus = (bugs: FoundBug[]) => [...bugs.filter((b) => !isClosedBug(b)), ...bugs.filter(isClosedBug)]
