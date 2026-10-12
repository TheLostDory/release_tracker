import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { permissionsFor } from '@/lib/permissions'
import { CurrentProjectContext, type CurrentProjectState } from './current-project-context'
import { useMyProjects } from './queries'

const STORAGE_KEY = 'release-tracker:current-project'

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function CurrentProjectProvider({ children }: { children: ReactNode }) {
  const { data: projects = [], isLoading } = useMyProjects()
  const [selectedId, setSelectedId] = useState<string | null>(readStoredId)

  const setCurrentProjectId = useCallback((id: string) => {
    setSelectedId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Selection still works for this session.
    }
  }, [])

  const value = useMemo<CurrentProjectState>(() => {
    // Falls back to the first project if the stored one is gone (left/deleted).
    const currentProject = projects.find((p) => p.id === selectedId) ?? projects[0] ?? null
    return {
      projects,
      currentProject,
      permissions: permissionsFor(currentProject?.role),
      isLoading,
      setCurrentProjectId,
    }
  }, [projects, selectedId, isLoading, setCurrentProjectId])

  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>
}
