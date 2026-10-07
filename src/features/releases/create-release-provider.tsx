import { useCallback, useState, type ReactNode } from 'react'
import { CreateReleaseContext, type CreateReleaseDefaults } from './create-release-context'
import { ReleaseDialog } from './release-dialog'

export function CreateReleaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; defaults: CreateReleaseDefaults }>({
    open: false,
    defaults: {},
  })
  const open = useCallback((defaults: CreateReleaseDefaults = {}) => setState({ open: true, defaults }), [])

  return (
    <CreateReleaseContext.Provider value={open}>
      {children}
      <ReleaseDialog
        open={state.open}
        onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}
        defaultSprintId={state.defaults.sprintId}
      />
    </CreateReleaseContext.Provider>
  )
}
