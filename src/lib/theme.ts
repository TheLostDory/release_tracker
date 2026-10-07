/**
 * Theme preference: 'light' | 'dark' | 'system' (follows the OS).
 * public/theme-init.js applies it before first paint; this module keeps it in
 * sync afterwards. Storage key and logic must match that file.
 */
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'release-tracker:theme'
const CHANGE_EVENT = 'release-tracker:theme-change'
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

/** Browser UI colour (address bar / PWA title bar) per theme. */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#0a0a0a' }

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref
  return darkQuery().matches ? 'dark' : 'light'
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Not persisted; still applied for this session.
  }
  applyTheme(resolveTheme(pref))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** Notifies on preference changes (this tab or others) and OS theme changes. */
export function subscribeTheme(onChange: () => void): () => void {
  const mq = darkQuery()
  const onSystem = () => {
    if (getThemePreference() === 'system') applyTheme(resolveTheme('system'))
    onChange()
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    applyTheme(resolveTheme(getThemePreference()))
    onChange()
  }
  mq.addEventListener('change', onSystem)
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    mq.removeEventListener('change', onSystem)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}
