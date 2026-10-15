import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { onUnauthorized } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { getCurrentUser, onAuthChange, sessionEnded } from '@/services/auth'
import type { User } from '@/types/domain'
import { AuthContext, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    getCurrentUser()
      .then((u) => active && setUser(u))
      .catch(() => active && setUser(null))
    const offAuth = onAuthChange((next) => {
      setUser((prev) => {
        // Drop cached data from a previous user on sign-out / user switch.
        if (prev?.id !== next?.id) queryClient.clear()
        return next
      })
    })
    // Any 401 from the API means the session is gone.
    const offUnauthorized = onUnauthorized(sessionEnded)
    return () => {
      active = false
      offAuth()
      offUnauthorized()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      status: user === undefined ? 'loading' : user ? 'authenticated' : 'anonymous',
      user: user ?? null,
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
