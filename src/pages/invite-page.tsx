import { useNavigate, useParams } from 'react-router'
import { Link2, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { PageTitle } from '@/components/page-title'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAcceptInviteLink, useInviteLinkInfo } from '@/features/projects/queries'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/permissions'
import { toUserMessage } from '@/lib/supabase-errors'

const PROJECT_KEY = 'release-tracker:current-project'

/** /invite/:token, reached from a shared link (sign-in happens first). */
export default function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { data: info, isLoading, error } = useInviteLinkInfo(token)
  const accept = useAcceptInviteLink()

  function openProject(projectId: string) {
    try {
      localStorage.setItem(PROJECT_KEY, projectId)
    } catch {
      // Falls back to the first project.
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <PageTitle title="Project invitation" />
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-background p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Rocket className="size-4" /> Release Tracker
        </div>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error || !info ? (
          <>
            <h1 className="text-base font-semibold">This invite link doesn't work</h1>
            <p className="text-sm text-muted-foreground">
              It may have expired or been revoked. Ask a project admin for a new one.
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate('/')}>
              Go to the app
            </Button>
          </>
        ) : (
          <>
            <div>
              <h1 className="flex items-center gap-2 text-base font-semibold">
                <Link2 className="size-4" /> Join {info.project_name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {info.already_member
                  ? "You're already a member of this project."
                  : `You'll join as ${ROLE_LABELS[info.role].toLowerCase()}: ${ROLE_DESCRIPTIONS[info.role].toLowerCase()}.`}
              </p>
            </div>
            {info.already_member ? (
              <Button className="w-full" onClick={() => openProject(info.project_id)}>
                Open project
              </Button>
            ) : (
              <Button
                className="w-full"
                disabled={accept.isPending}
                onClick={() =>
                  accept.mutate(token, {
                    onSuccess: (projectId) => {
                      toast.success(`Welcome to ${info.project_name}`)
                      openProject(projectId)
                    },
                    onError: (err) => toast.error(toUserMessage(err)),
                  })
                }
              >
                {accept.isPending ? 'Joining…' : `Join ${info.project_name}`}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
