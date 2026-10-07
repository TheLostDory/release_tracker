import { createContext, useContext } from 'react'

export interface CreateReleaseDefaults {
  sprintId?: string
}

export const CreateReleaseContext = createContext<((defaults?: CreateReleaseDefaults) => void) | null>(null)

/** Opens the global "New release" dialog. */
export function useOpenCreateRelease() {
  const open = useContext(CreateReleaseContext)
  if (!open) throw new Error('useOpenCreateRelease must be used inside <CreateReleaseProvider>')
  return open
}
