import { api } from '@/lib/api'
import type { User } from '@/types/domain'

/**
 * Auth against the Express API (HttpOnly session cookie). Components use the
 * AuthProvider; this module also notifies it after sign-in/out.
 */
export interface Credentials {
  email: string
  password: string
}

export interface SignUpInput extends Credentials {
  name: string
}

type Listener = (user: User | null) => void
const listeners = new Set<Listener>()
const emit = (user: User | null) => listeners.forEach((l) => l(user))

export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The signed-in user, or null when there is no valid session. */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return (await api.get<{ user: User }>('/auth/me')).user
  } catch (err) {
    if ((err as { status?: number }).status === 401) return null
    throw err
  }
}

export async function signInWithPassword(credentials: Credentials): Promise<void> {
  const { user } = await api.post<{ user: User }>('/auth/login', credentials)
  emit(user)
}

/** Accounts are active immediately (no email confirmation step). */
export async function signUp(input: SignUpInput): Promise<'signed-in'> {
  const { user } = await api.post<{ user: User }>('/auth/signup', input)
  emit(user)
  return 'signed-in'
}

export async function signOut(): Promise<void> {
  await api.post('/auth/logout')
  emit(null)
}

/** The server rejected the session (expired/revoked) mid-use. */
export function sessionEnded(): void {
  emit(null)
}
