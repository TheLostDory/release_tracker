import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, ChevronsUpDown, Plus, Settings } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { CreateProjectDialog } from '@/features/projects/create-project-dialog'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { ROLE_LABELS } from '@/lib/permissions'

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function ProjectSwitcher() {
  const navigate = useNavigate()
  const { projects, currentProject, setCurrentProjectId, isLoading, permissions } = useCurrentProject()
  const [creating, setCreating] = useState(false)

  if (isLoading) return <Skeleton className="h-12 w-full" />

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" tooltip={currentProject?.name ?? 'Projects'} aria-label="Switch project">
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                  {currentProject ? initials(currentProject.name) : <Plus className="size-4" />}
                </div>
                <div className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">{currentProject?.name ?? 'No project'}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {currentProject ? ROLE_LABELS[currentProject.role] : 'Create or join one'}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
              {projects.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() => {
                    setCurrentProjectId(p.id)
                    navigate('/')
                  }}
                >
                  <span className="flex size-5 items-center justify-center rounded bg-muted text-[10px] font-semibold">
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.id === currentProject?.id && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {currentProject && permissions.canManage && (
                <DropdownMenuItem onSelect={() => navigate('/settings/project')}>
                  <Settings />
                  Project settings
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setCreating(true)}>
                <Plus />
                New project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
