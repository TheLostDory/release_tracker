import { Suspense, useCallback, useMemo, useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
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
import { CurrentSprintProvider } from '@/features/sprints/current-sprint-provider'
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts'

export default function AppLayout() {
  return (
    <CurrentSprintProvider>
      <CreateReleaseProvider>
        <Shell />
      </CreateReleaseProvider>
    </CurrentSprintProvider>
  )
}

function Shell() {
  const navigate = useNavigate()
  const openCreateRelease = useOpenCreateRelease()
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
  const single = useMemo(() => ({ c: () => openCreateRelease(), '?': openShortcuts }), [openCreateRelease, openShortcuts])
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
      <SidebarInset>
        <TopBar onOpenSearch={openCommand} />
        <OfflineBanner />
        <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
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
