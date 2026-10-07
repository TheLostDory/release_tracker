import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { CurrentSprintContext, type CurrentSprintState } from './current-sprint-context'
import { pickDefaultSprint } from './pick-default-sprint'
import { useSprints } from './queries'

const STORAGE_KEY = 'release-tracker:current-sprint'

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function CurrentSprintProvider({ children }: { children: ReactNode }) {
  const { data: sprints = [], isLoading } = useSprints()
  const [selectedId, setSelectedId] = useState<string | null>(readStoredId)

  const setCurrentSprintId = useCallback((id: string) => {
    setSelectedId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Storage unavailable (private mode); selection still works for this session.
    }
  }, [])

  const value = useMemo<CurrentSprintState>(
    () => ({
      sprints,
      currentSprint: sprints.find((s) => s.id === selectedId) ?? pickDefaultSprint(sprints),
      isLoading,
      setCurrentSprintId,
    }),
    [sprints, selectedId, isLoading, setCurrentSprintId],
  )

  return <CurrentSprintContext.Provider value={value}>{children}</CurrentSprintContext.Provider>
}
