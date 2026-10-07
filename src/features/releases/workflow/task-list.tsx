import { Fragment, useState } from 'react'
import { ArrowDown, ChevronRight, ExternalLink, Link2, StickyNote } from 'lucide-react'
import { TaskStatusBadge } from '@/components/status-badges'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useProfiles } from '@/features/profiles/queries'
import { dueTone, toDayString } from '@/lib/dates'
import { safeHttpUrl } from '@/lib/safe-url'
import { TASK_STATUS_LABELS } from '@/lib/status-labels'
import { cn } from '@/lib/utils'
import { isDone, STEP_BY_TYPE, unmetDependencies, type WorkflowStep } from '@/lib/workflow'
import type { TaskStatus, WorkflowTaskType } from '@/types/domain'
import type { ReleaseTask, TaskPatch } from '../api'
import { managedCardId } from './card-ids'

const UNASSIGNED = '__unassigned'

/** Scroll to the controlling card, focus it and briefly highlight it. */
function revealCard(type: WorkflowTaskType) {
  const el = document.getElementById(managedCardId(type))
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.focus({ preventScroll: true })
  el.classList.add('ring-2', 'ring-blue-500')
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500'), 1600)
}
const STATUSES = Object.keys(TASK_STATUS_LABELS) as TaskStatus[]

interface Props {
  tasks: readonly ReleaseTask[]
  current: WorkflowTaskType | null
  onUpdate: (task: ReleaseTask, patch: TaskPatch) => void
  guard: (stepName: string, unmet: WorkflowStep[], proceed: () => void) => void
}

export function TaskList({ tasks, current, onUpdate, guard }: Props) {
  const { data: profiles = [] } = useProfiles()
  const [expanded, setExpanded] = useState<string | null>(null)

  function changeStatus(task: ReleaseTask, status: TaskStatus) {
    const apply = () => {
      onUpdate(task, { status })
      if (status === 'BLOCKED') setExpanded(task.id)
    }
    if (status === 'COMPLETED') guard(task.name, unmetDependencies(task.task_type, tasks), apply)
    else apply()
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Step</TableHead>
            <TableHead className="w-36">Status</TableHead>
            <TableHead className="w-36">Planned</TableHead>
            <TableHead className="hidden w-36 md:table-cell">Completed</TableHead>
            <TableHead className="hidden w-36 sm:table-cell">Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const step = STEP_BY_TYPE[task.task_type]
            const open = expanded === task.id
            const overdue = !isDone(task.status) && task.planned_date !== null && dueTone(task.planned_date) === 'overdue'
            const dueToday = !isDone(task.status) && task.planned_date !== null && dueTone(task.planned_date) === 'today'
            return (
              <Fragment key={task.id}>
                <TableRow
                  data-state={task.task_type === current ? 'selected' : undefined}
                  className={cn(task.task_type === current && 'bg-blue-500/5 data-[state=selected]:bg-blue-500/5')}
                >
                  <TableCell className="pr-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} details for ${task.name}`}
                      onClick={() => setExpanded(open ? null : task.id)}
                    >
                      <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('font-medium', task.status === 'SKIPPED' && 'text-muted-foreground line-through')}>
                        {task.name}
                      </span>
                      {task.notes && <StickyNote className="size-3 text-muted-foreground" aria-label="Has notes" />}
                      {task.link && <Link2 className="size-3 text-muted-foreground" aria-label="Has link" />}
                    </div>
                    {task.status === 'BLOCKED' && task.blocker_reason && (
                      <p className="text-xs text-red-600 dark:text-red-400">{task.blocker_reason}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {step.managedBy ? (
                      <button
                        type="button"
                        onClick={() => revealCard(task.task_type)}
                        className="group rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={`${task.name}: ${task.status.toLowerCase().replace('_', ' ')}. Set it on the ${step.managedBy} card below`}
                      >
                        <TaskStatusBadge status={task.status} />
                        <span className="mt-0.5 flex items-center gap-0.5 text-[11px] text-blue-700 group-hover:underline dark:text-blue-400">
                          Set in {step.managedBy}
                          <ArrowDown className="size-3" />
                        </span>
                      </button>
                    ) : (
                      <Select value={task.status} onValueChange={(v) => changeStatus(task, v as TaskStatus)}>
                        <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={`Status of ${task.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              <TaskStatusBadge status={s} />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      aria-label={`Planned date of ${task.name}`}
                      className={cn(
                        'h-7 text-xs tabular-nums',
                        overdue && 'border-red-500/50 text-red-600 dark:text-red-400',
                        dueToday && 'border-amber-500/50 text-amber-700 dark:text-amber-400',
                      )}
                      value={task.planned_date ?? ''}
                      onChange={(e) => onUpdate(task, { planned_date: e.target.value || null })}
                    />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {task.status === 'COMPLETED' ? (
                      <Input
                        type="date"
                        aria-label={`Completed date of ${task.name}`}
                        className="h-7 text-xs tabular-nums"
                        value={task.completed_at ? toDayString(new Date(task.completed_at)) : ''}
                        onChange={(e) => {
                          if (!e.target.value) return
                          // Noon local time keeps the chosen day in any nearby timezone.
                          const [y, m, d] = e.target.value.split('-').map(Number)
                          onUpdate(task, { completed_at: new Date(y!, m! - 1, d!, 12).toISOString() })
                        }}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Select
                      value={task.owner_id ?? UNASSIGNED}
                      onValueChange={(v) => onUpdate(task, { owner_id: v === UNASSIGNED ? null : v })}
                    >
                      <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={`Owner of ${task.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
                {open && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell />
                    <TableCell colSpan={5} className="pb-4">
                      <TaskDetails task={task} onUpdate={onUpdate} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** Notes, link and blocker reason; each saves on blur when changed. */
function TaskDetails({ task, onUpdate }: { task: ReleaseTask; onUpdate: Props['onUpdate'] }) {
  const [linkError, setLinkError] = useState<string | null>(null)
  const safeLink = safeHttpUrl(task.link)

  return (
    <div className="grid gap-3 whitespace-normal md:grid-cols-2">
      <label className="space-y-1 text-xs font-medium md:row-span-2">
        Notes
        <Textarea
          key={`notes-${task.notes}`}
          defaultValue={task.notes ?? ''}
          rows={3}
          placeholder="Add context for the team…"
          className="text-sm font-normal"
          onBlur={(e) => {
            const value = e.target.value.trim() || null
            if (value !== task.notes) onUpdate(task, { notes: value })
          }}
        />
      </label>
      <div className="space-y-1 text-xs font-medium">
        <label htmlFor={`link-${task.id}`}>Link</label>
        <div className="flex gap-1">
          <Input
            id={`link-${task.id}`}
            key={`link-${task.link}`}
            type="url"
            defaultValue={task.link ?? ''}
            placeholder="https://…"
            aria-invalid={linkError ? true : undefined}
            className="h-8 text-sm font-normal"
            onBlur={(e) => {
              const raw = e.target.value.trim()
              if (raw && !safeHttpUrl(raw)) {
                setLinkError('Use a full http(s):// URL.')
                return
              }
              setLinkError(null)
              if ((raw || null) !== task.link) onUpdate(task, { link: raw || null })
            }}
          />
          {safeLink && (
            <Button asChild variant="outline" size="icon" className="size-8 shrink-0">
              <a href={safeLink} target="_blank" rel="noopener noreferrer" aria-label="Open link">
                <ExternalLink />
              </a>
            </Button>
          )}
        </div>
        {linkError && <p className="font-normal text-destructive">{linkError}</p>}
      </div>
      {task.status === 'BLOCKED' && !STEP_BY_TYPE[task.task_type].managedBy && (
        <label className="space-y-1 text-xs font-medium">
          Blocker reason
          <Input
            key={`blocker-${task.blocker_reason}`}
            autoFocus={!task.blocker_reason}
            defaultValue={task.blocker_reason ?? ''}
            placeholder="What is blocking this step?"
            className="h-8 text-sm font-normal"
            onBlur={(e) => {
              const value = e.target.value.trim() || null
              if (value !== task.blocker_reason) onUpdate(task, { blocker_reason: value })
            }}
          />
        </label>
      )}
    </div>
  )
}
