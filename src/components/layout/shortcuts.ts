import { PRIMARY_NAV, SECONDARY_NAV } from './nav-items'

export const SHORTCUT_GROUPS = [
  {
    title: 'General',
    items: [
      { label: 'Search & commands', keys: ['⌘', 'K'] },
      { label: 'New release', keys: ['C'] },
      { label: 'Toggle sidebar', keys: ['⌘', 'B'] },
      { label: 'Show shortcuts', keys: ['?'] },
    ],
  },
  {
    title: 'Go to',
    items: [...PRIMARY_NAV, ...SECONDARY_NAV].map((n) => ({ label: n.label, keys: ['G', n.shortcut.toUpperCase()] })),
  },
] as const
