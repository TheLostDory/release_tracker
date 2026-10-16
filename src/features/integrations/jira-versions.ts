import type { JiraVersion } from './api'

/**
 * Versions to show in "Import from Jira": archived hidden, released only when
 * asked, matching every word of the query (name or description, any order),
 * unreleased first by release date (versions without a date last).
 */
export function filterVersions(versions: readonly JiraVersion[], query: string, showReleased: boolean): JiraVersion[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return versions
    .filter((v) => !v.archived && (showReleased || !v.released))
    .filter((v) => {
      const text = `${v.name} ${v.description ?? ''}`.toLowerCase()
      return words.every((w) => text.includes(w))
    })
    .sort((a, b) => Number(a.released) - Number(b.released) || (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'))
}
