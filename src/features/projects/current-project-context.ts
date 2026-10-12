import { createContext, useContext } from 'react'
import type { Permissions } from '@/lib/permissions'
import type { Project } from './api'

export interface CurrentProjectState {
  projects: Project[]
  currentProject: Project | null
  permissions: Permissions
  isLoading: boolean
  setCurrentProjectId: (id: string) => void
}

export const CurrentProjectContext = createContext<CurrentProjectState | null>(null)

export function useCurrentProject(): CurrentProjectState {
  const ctx = useContext(CurrentProjectContext)
  if (!ctx) throw new Error('useCurrentProject must be used inside <CurrentProjectProvider>')
  return ctx
}
