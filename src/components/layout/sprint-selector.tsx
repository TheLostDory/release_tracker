import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrentSprint } from '@/features/sprints/current-sprint-context'
import { formatDayRange } from '@/lib/dates'

export function SprintSelector() {
  const { sprints, currentSprint, isLoading, setCurrentSprintId } = useCurrentSprint()

  if (isLoading) return <Skeleton className="h-8 w-40" />
  if (!currentSprint) return null

  return (
    <Select value={currentSprint.id} onValueChange={setCurrentSprintId}>
      <SelectTrigger size="sm" className="w-auto min-w-40 gap-2" aria-label="Current sprint">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sprints.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="font-medium">{s.name}</span>
            <span className="text-xs text-muted-foreground">{formatDayRange(s.start_date, s.end_date)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
