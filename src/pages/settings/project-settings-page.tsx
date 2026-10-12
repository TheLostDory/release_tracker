import { PageTitle } from '@/components/page-title'
import { useCurrentProject } from '@/features/projects/current-project-context'
import { DangerSection } from '@/features/projects/settings/danger-section'
import { GeneralSection } from '@/features/projects/settings/general-section'
import { InvitationsSection } from '@/features/projects/settings/invitations-section'
import { MembersSection } from '@/features/projects/settings/members-section'
import { WorkflowSection } from '@/features/projects/settings/workflow-section'

export default function ProjectSettingsPage() {
  const { currentProject: project, permissions } = useCurrentProject()
  if (!project) return null

  return (
    <div className="max-w-5xl space-y-6">
      <PageTitle title={`${project.name} settings`} />
      <GeneralSection project={project} canManage={permissions.canManage} />
      <WorkflowSection project={project} canManage={permissions.canManage} />
      <MembersSection project={project} />
      {permissions.canManage && <InvitationsSection project={project} />}
      <DangerSection project={project} />
    </div>
  )
}
