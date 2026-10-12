import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { FolderKanban, FolderPlus, Keyboard, Layers, Loader2, Moon, Plus, Rocket, Sun } from 'lucide-react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { CreateProjectDialog } from '@/features/projects/create-project-dialog'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { useOpenCreateRelease } from '@/features/releases/create-release-context'
import { useReleaseSearch } from '@/features/search/queries'
import { useCurrentSprint } from '@/features/sprints/current-sprint-context'
import { useTheme } from '@/hooks/use-theme'
import { formatDay } from '@/lib/dates'
import { PRIMARY_NAV, SECONDARY_NAV } from './nav-items'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onShowShortcuts: () => void
}

function matches(text: string, q: string) {
  return text.toLowerCase().includes(q)
}

export function CommandMenu({ open, onOpenChange, onShowShortcuts }: Props) {
  const [creatingProject, setCreatingProject] = useState(false)
  return (
    <>
      <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search releases and run commands">
        {/* Remount on open so the query starts empty. */}
        {open && (
          <CommandMenuBody
            onClose={() => onOpenChange(false)}
            onShowShortcuts={onShowShortcuts}
            onNewProject={() => setCreatingProject(true)}
          />
        )}
      </CommandDialog>
      <CreateProjectDialog open={creatingProject} onOpenChange={setCreatingProject} />
    </>
  )
}

function CommandMenuBody({
  onClose,
  onShowShortcuts,
  onNewProject,
}: {
  onClose: () => void
  onShowShortcuts: () => void
  onNewProject: () => void
}) {
  const navigate = useNavigate()
  const { sprints, setCurrentSprintId } = useCurrentSprint()
  const openCreateRelease = useOpenCreateRelease()
  const { projects, currentProject, setCurrentProjectId, permissions } = useCurrentProject()
  const theme = useTheme()
  const [input, setInput] = useState('')
  const q = input.trim().toLowerCase()
  const search = useReleaseSearch(input)

  const run = (action: () => void) => {
    onClose()
    action()
  }

  // Filtering is ours (server results can't be re-ranked by cmdk's fuzzy match).
  const actions = useMemo(
    () =>
      [
        ...(permissions.canEdit
          ? [{ id: 'new-release', label: 'New release', icon: Plus, shortcut: 'C', run: () => openCreateRelease() }]
          : []),
        { id: 'new-project', label: 'New project', icon: FolderPlus, shortcut: '', run: onNewProject },
        { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: '?', run: onShowShortcuts },
        theme.resolved === 'dark'
          ? { id: 'theme', label: 'Switch to light theme', icon: Sun, shortcut: '', run: () => theme.setPreference('light') }
          : { id: 'theme', label: 'Switch to dark theme', icon: Moon, shortcut: '', run: () => theme.setPreference('dark') },
      ].filter((a) => !q || matches(`${a.label} theme mode`, q)),
    [q, openCreateRelease, onShowShortcuts, onNewProject, theme, permissions.canEdit],
  )
  const pages = [...PRIMARY_NAV, ...SECONDARY_NAV].filter((p) => !q || matches(p.label, q))
  const sprintItems = sprints.filter((s) => !q || matches(s.name, q)).slice(0, q ? 5 : 3)
  const projectItems = projects.filter((p) => p.id !== currentProject?.id && (!q || matches(p.name, q)))
  const releases = q ? (search.data ?? []) : []
  const searching = q.length > 0 && search.isFetching

  const nothing = actions.length + pages.length + sprintItems.length + projectItems.length + releases.length === 0

  return (
    <Command shouldFilter={false} loop>
      <CommandInput placeholder="Search releases, versions, sprints, owners…" value={input} onValueChange={setInput} />
      <CommandList>
        {nothing && !searching && <CommandEmpty>No results for “{input.trim()}”.</CommandEmpty>}

        {q && (
          <CommandGroup heading={searching ? 'Releases · searching…' : 'Releases'}>
            {releases.map((r) => (
              <CommandItem key={r.id} value={`release-${r.id}`} onSelect={() => run(() => navigate(`/releases/${r.id}`))}>
                <Rocket />
                <span className="font-medium">{r.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.version}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[r.project_name, r.sprint_name, r.owner_name].filter(Boolean).join(' · ')}
                </span>
                <CommandShortcut>
                  {r.actual_deployment_date ? 'Deployed' : formatDay(r.planned_deployment_date)}
                </CommandShortcut>
              </CommandItem>
            ))}
            {searching && releases.length === 0 && (
              <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching…
              </div>
            )}
            {search.isError && <div className="px-2 py-1.5 text-sm text-destructive">Search failed. Try again.</div>}
          </CommandGroup>
        )}

        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem key={a.id} value={a.id} onSelect={() => run(a.run)}>
                <a.icon />
                {a.label}
                {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {pages.length > 0 && (
          <CommandGroup heading="Go to">
            {pages.map((item) => (
              <CommandItem key={item.to} value={`go-${item.to}`} onSelect={() => run(() => navigate(item.to))}>
                <item.icon />
                {item.label}
                <CommandShortcut>G {item.shortcut.toUpperCase()}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {projectItems.length > 0 && (
          <CommandGroup heading="Switch project">
            {projectItems.map((p) => (
              <CommandItem
                key={p.id}
                value={`project-${p.id}`}
                onSelect={() =>
                  run(() => {
                    setCurrentProjectId(p.id)
                    navigate('/')
                  })
                }
              >
                <FolderKanban />
                {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sprintItems.length > 0 && (
          <CommandGroup heading="Sprints">
            {sprintItems.map((s) => (
              <CommandItem
                key={s.id}
                value={`sprint-${s.id}`}
                onSelect={() =>
                  run(() => {
                    setCurrentSprintId(s.id)
                    navigate(`/sprints/${s.id}`)
                  })
                }
              >
                <Layers />
                {s.name}
                <CommandShortcut>{s.release_count} releases</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
