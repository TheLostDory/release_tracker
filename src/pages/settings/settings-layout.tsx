import { NavLink, Outlet } from 'react-router'
import { PageHeader } from '@/components/page-header'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { cn } from '@/lib/utils'

export default function SettingsLayout() {
  const { currentProject } = useCurrentProject()
  const tabs = [
    ...(currentProject ? [{ to: '/settings/project', label: `Project · ${currentProject.name}` }] : []),
    { to: '/settings/account', label: 'Account' },
  ]
  return (
    <>
      <PageHeader title="Settings" />
      <nav aria-label="Settings sections" className="mb-6 flex gap-1 border-b">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                '-mb-px max-w-72 truncate border-b-2 px-3 py-2 text-sm',
                isActive ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  )
}
