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

export interface SignUpInput extends Credentials {
  name: string
}

/**
 * Creates an account. Returns 'signed-in' when the server confirms
 * immediately, or 'confirm-email' when it sent a confirmation link first.
 */
export async function signUp({ email, password, name }: SignUpInput): Promise<'signed-in' | 'confirm-email'> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // The profile's display name is taken from this (handle_new_user()).
    options: { data: { name }, emailRedirectTo: window.location.origin },
  })
  if (error) throw error
  return data.session ? 'signed-in' : 'confirm-email'
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
