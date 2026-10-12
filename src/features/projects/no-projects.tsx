import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { CreateProjectDialog } from './create-project-dialog'

/** Shown instead of any page when the user belongs to no project. */
export function NoProjects() {
  const [creating, setCreating] = useState(false)
  return (
    <>
      <EmptyState
        icon={FolderPlus}
        title="You're not in any project yet"
        description="Create a project to start tracking releases, or ask a project admin to invite you (by email or with an invite link)."
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            Create a project
          </Button>
        }
      />
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
