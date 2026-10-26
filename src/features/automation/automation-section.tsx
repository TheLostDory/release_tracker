import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Project } from '@/features/projects/api'
import { SettingsSection } from '@/features/projects/settings/settings-section'
import { toUserMessage } from '@/lib/errors'
import { STEP_BY_TYPE } from '@/lib/workflow'
import type { AutomationSettings } from './api'
import { useAutomation, useSaveAutomation } from './queries'

/** Project settings → Automation: what the tracker does by itself. */
export function AutomationSection({ project, canManage }: { project: Project; canManage: boolean }) {
  const { data, isLoading } = useAutomation(project.id)
  return (
    <SettingsSection
      title="Automation"
      description="What the tracker does by itself for this project. Background tasks run while the app is running."
    >
      {isLoading || !data ? (
        <div className="h-24 animate-pulse rounded-md bg-muted/50" />
      ) : (
        <AutomationForm key={JSON.stringify(data)} project={project} initial={data} canManage={canManage} />
      )}
    </SettingsSection>
  )
}

function AutomationForm({ project, initial, canManage }: { project: Project; initial: AutomationSettings; canManage: boolean }) {
  const [s, setS] = useState(initial)
  const save = useSaveAutomation(project.id)
  const dirty = JSON.stringify(s) !== JSON.stringify(initial)
  const set = <K extends keyof AutomationSettings>(key: K, value: AutomationSettings[K]) => setS((prev) => ({ ...prev, [key]: value }))

  return (
    <div className="space-y-4">
      <fieldset disabled={!canManage} className="space-y-4">
        <Block
          title="Plan step dates"
          enabled={s.planDates.enabled}
          onToggle={(enabled) => set('planDates', { ...s.planDates, enabled })}
          description="New releases get a planned date for every step, counted back from the target deployment date (weekends move to the Friday before). When the target moves, open steps move with it."
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {project.enabled_steps.map((type) => (
              <label key={type} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{STEP_BY_TYPE[type].name}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    className="h-7 w-16 text-right"
                    aria-label={`${STEP_BY_TYPE[type].name}: days before target`}
                    value={s.planDates.offsets[type] ?? 0}
                    onChange={(e) =>
                      set('planDates', { ...s.planDates, offsets: { ...s.planDates.offsets, [type]: Math.max(0, Math.min(365, Number(e.target.value) || 0)) } })
                    }
                  />
                  days before
                </span>
              </label>
            ))}
          </div>
        </Block>
      </fieldset>

      {canManage ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(s, {
                onSuccess: () => toast.success('Automation saved'),
                onError: (err) => toast.error(toUserMessage(err)),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save automation'}
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setS(initial)}>
              Discard changes
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only admins and owners can change automation.</p>
      )}
    </div>
  )
}

/** One automation: a switch, what it does, and its options (shown while on). */
export function Block({
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string
  description: ReactNode
  enabled: boolean
  onToggle: (enabled: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 size-4 accent-foreground" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        <span>
          <span className="text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{description}</span>
        </span>
      </label>
      {enabled && children && <div className="pl-6">{children}</div>}
    </div>
  )
}
