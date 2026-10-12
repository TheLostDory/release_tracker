import { Link } from 'react-router'
import { Layers } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { useCurrentProject } from '@/features/projects/current-project-context'

export function SprintsDisabled() {
  const { currentProject, permissions } = useCurrentProject()
  return (
    <EmptyState
      icon={Layers}
      title="Sprints are turned off"
      description={`${currentProject?.name ?? 'This project'} tracks releases without sprints.`}
      action={
        permissions.canManage ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/settings/project">Project settings</Link>
          </Button>
        ) : undefined
      }
    />
  )
}
