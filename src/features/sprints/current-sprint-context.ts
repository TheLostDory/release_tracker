import { createContext, useContext } from 'react'
import type { SprintWithCount } from '@/types/domain'

export interface CurrentSprintState {
  sprints: SprintWithCount[]
  currentSprint: SprintWithCount | null
  isLoading: boolean
  setCurrentSprintId: (id: string) => void
}

export const CurrentSprintContext = createContext<CurrentSprintState | null>(null)

export function useCurrentSprint(): CurrentSprintState {
  const ctx = useContext(CurrentSprintContext)
  if (!ctx) throw new Error('useCurrentSprint must be used inside <CurrentSprintProvider>')
  return ctx
}
