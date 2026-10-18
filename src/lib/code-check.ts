/**
 * "Does what was merged into the RC match Jira?" as one state, from the
 * latest comparison counts. Shared by the release page, the releases list
 * and the action items.
 */
export interface CodeCheckCounts {
  jira_only: number
  jira_only_done: number
  code_only: number
  no_key: number
  matched: number
  has_jira: boolean
  error: string | null
}

export type CodeCheckState =
  | { kind: 'unchecked' }
  | { kind: 'error'; message: string }
  | { kind: 'no_jira' }
  | { kind: 'match' }
  | { kind: 'differs'; differences: number; parts: string[] }

export function codeCheckState(c: CodeCheckCounts | null | undefined): CodeCheckState {
  if (!c) return { kind: 'unchecked' }
  if (c.error) return { kind: 'error', message: c.error }
  if (!c.has_jira) return { kind: 'no_jira' }
  const differences = c.jira_only + c.code_only + c.no_key
  if (differences === 0) return { kind: 'match' }
  return { kind: 'differs', differences, parts: differenceParts(c) }
}

/** "3 in Jira not merged (1 marked Done)", "2 merged not in the version", "1 merged without an issue". */
export function differenceParts(c: CodeCheckCounts): string[] {
  return [
    c.jira_only > 0 && `${c.jira_only} in Jira not merged${c.jira_only_done > 0 ? ` (${c.jira_only_done} marked Done)` : ''}`,
    c.code_only > 0 && `${c.code_only} merged not in the version`,
    c.no_key > 0 && `${c.no_key} merged without an issue`,
  ].filter((p): p is string => !!p)
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
