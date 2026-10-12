import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { CurrentSprintContext, type CurrentSprintState } from './current-sprint-context'
import { pickDefaultSprint } from './pick-default-sprint'
import { useSprints } from './queries'

const STORAGE_KEY = 'release-tracker:current-sprint'

function readStored(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return value && typeof value === 'object' ? (value as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Current sprint of the current project (remembered per project). */
export function CurrentSprintProvider({ children }: { children: ReactNode }) {
  const { currentProject } = useCurrentProject()
  const enabled = !!currentProject?.sprints_enabled
  const { data: sprints = [], isLoading } = useSprints(currentProject?.id, enabled)
  const [selected, setSelected] = useState<Record<string, string>>(readStored)

  const setCurrentSprintId = useCallback(
    (id: string) => {
      if (!currentProject) return
      setSelected((prev) => {
        const next = { ...prev, [currentProject.id]: id }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
          // Selection still works for this session.
        }
        return next
      })
    },
    [currentProject],
  )

  const value = useMemo<CurrentSprintState>(() => {
    const list = enabled ? sprints : []
    const selectedId = currentProject ? selected[currentProject.id] : undefined
    return {
      sprints: list,
      currentSprint: list.find((s) => s.id === selectedId) ?? pickDefaultSprint(list),
      isLoading: enabled && isLoading,
      setCurrentSprintId,
    }
  }, [enabled, sprints, currentProject, selected, isLoading, setCurrentSprintId])

  return <CurrentSprintContext.Provider value={value}>{children}</CurrentSprintContext.Provider>
}
