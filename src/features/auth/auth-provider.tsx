import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { queryClient } from '@/lib/query-client'
import { getSession, onAuthChange } from '@/services/auth'
import { AuthContext, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    getSession()
      .then((s) => active && setSession(s))
      .catch(() => active && setSession(null))
    const unsubscribe = onAuthChange((s) => {
      setSession((prev) => {
        // Drop cached data from a previous user on sign-out / user switch.
        if (prev?.user.id !== s?.user.id) queryClient.clear()
        return s
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      status: session === undefined ? 'loading' : session ? 'authenticated' : 'anonymous',
      session: session ?? null,
      user: session?.user ?? null,
    }),
    [session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
