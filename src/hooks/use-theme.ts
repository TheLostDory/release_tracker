import { useSyncExternalStore } from 'react'
import {
  getThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme'

export function useTheme(): {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (pref: ThemePreference) => void
} {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference)
  const resolved = useSyncExternalStore(subscribeTheme, () => resolveTheme(getThemePreference()))
  return { preference, resolved, setPreference: setThemePreference }
}
