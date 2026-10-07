import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Thin wrapper over Supabase Auth so the UI never talks to the provider
 * directly. SSO (e.g. signInWithSSO / OAuth) gets added here later.
 */

export interface Credentials {
  email: string
  password: string
}

export async function signInWithPassword({ email, password }: Credentials): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export function onAuthChange(callback: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session))
  return () => data.subscription.unsubscribe()
}
