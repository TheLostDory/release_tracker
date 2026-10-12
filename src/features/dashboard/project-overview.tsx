import type { ReactNode } from 'react'
import type { Project } from '@/features/projects/api'

/** Dashboard header for projects that don't use sprints. */
export function ProjectOverview({ project, recentDays, actions }: { project: Project; recentDays: number; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {project.description ? `${project.description} · ` : ''}
          Open releases and those deployed in the last {recentDays} days
        </p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
