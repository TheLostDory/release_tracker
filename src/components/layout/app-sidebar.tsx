import { NavLink, useLocation } from 'react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from './nav-items'
import { ProjectSwitcher } from './project-switcher'

function isActive(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

function NavMenu({ items }: { items: readonly NavItem[] }) {
  const { pathname } = useLocation()
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.to}>
          <SidebarMenuButton asChild isActive={isActive(pathname, item.to)} tooltip={item.label}>
            <NavLink to={item.to}>
              <item.icon />
              <span>{item.label}</span>
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

export function AppSidebar() {
  const { currentProject } = useCurrentProject()
  // Projects without sprints don't show the Sprints page.
  const items = PRIMARY_NAV.filter((i) => i.to !== '/sprints' || currentProject?.sprints_enabled !== false)
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProjectSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavMenu items={items} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavMenu items={SECONDARY_NAV} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
