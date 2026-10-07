import { CalendarDays, Gauge, Layers, Rocket, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Two-key "g <key>" shortcut. */
  shortcut: string
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Gauge, shortcut: 'd' },
  { to: '/sprints', label: 'Sprints', icon: Layers, shortcut: 's' },
  { to: '/releases', label: 'Releases', icon: Rocket, shortcut: 'r' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, shortcut: 'c' },
]

export const SECONDARY_NAV: readonly NavItem[] = [
  { to: '/settings', label: 'Settings', icon: Settings, shortcut: ',' },
]
