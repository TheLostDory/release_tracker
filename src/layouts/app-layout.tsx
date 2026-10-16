import { Suspense, useCallback, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { CommandMenu } from '@/components/layout/command-menu'
import { OfflineBanner } from '@/components/layout/offline-banner'
import { ShortcutsDialog } from '@/components/layout/shortcuts-dialog'
import { PRIMARY_NAV, SECONDARY_NAV } from '@/components/layout/nav-items'
import { TopBar } from '@/components/layout/top-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useOpenCreateRelease } from '@/features/releases/create-release-context'
import { CreateReleaseProvider } from '@/features/releases/create-release-provider'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { CurrentProjectProvider } from '@/features/projects/current-project-provider'
import { NoProjects } from '@/features/projects/no-projects'
import { CurrentSprintProvider } from '@/features/sprints/current-sprint-provider'
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts'

export default function AppLayout() {
  return (
    <CurrentProjectProvider>
      <CurrentSprintProvider>
        <CreateReleaseProvider>
          <Shell />
        </CreateReleaseProvider>
      </CurrentSprintProvider>
    </CurrentProjectProvider>
  )
}

function Shell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { projects, isLoading: projectsLoading, permissions } = useCurrentProject()
  const openCreateRelease = useOpenCreateRelease()
  // Account settings stay reachable without any project.
  const needsProject = !projectsLoading && projects.length === 0 && !pathname.startsWith('/settings/account')
  const [commandOpen, setCommandOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const openCommand = useCallback(() => setCommandOpen(true), [])
  const openShortcuts = useCallback(() => setShortcutsOpen(true), [])
  const goTo = useMemo(
    () =>
      Object.fromEntries(
        [...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => [item.shortcut, () => navigate(item.to)]),
      ),
    [navigate],
  )
  const single = useMemo(
    () => ({ ...(permissions.canEdit ? { c: () => openCreateRelease() } : {}), '?': openShortcuts }),
    [permissions.canEdit, openCreateRelease, openShortcuts],
  )
  useGlobalShortcuts({ onCommandMenu: openCommand, goTo, single })

  return (
    <SidebarProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <AppSidebar />
      {/* min-w-0: wide content (timelines, tables) scrolls inside itself instead of
          widening the page and sliding under the sidebar. */}
      <SidebarInset className="min-w-0">
        <TopBar onOpenSearch={openCommand} />
        <OfflineBanner />
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-6">
          <Suspense fallback={<PageSkeleton />}>
            {needsProject ? <NoProjects /> : <Outlet />}
          </Suspense>
        </main>
      </SidebarInset>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} onShowShortcuts={openShortcuts} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </SidebarProvider>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
