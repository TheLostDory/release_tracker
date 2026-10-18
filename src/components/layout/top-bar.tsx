import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { AssistantPanel } from '@/features/assistant/assistant-panel'
import { NotificationsMenu } from './notifications-menu'
import { SprintSelector } from './sprint-selector'
import { UserMenu } from './user-menu'

export function TopBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <SprintSelector />
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSearch}
          className="w-9 justify-start gap-2 text-muted-foreground sm:w-56"
          aria-label="Search"
        >
          <Search />
          <span className="hidden sm:inline">Search…</span>
          <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
        </Button>
        <AssistantPanel />
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  )
}
