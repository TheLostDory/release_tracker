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
        {/* The full name always; the dates only where there is room (they're in the list too). */}
        <SelectValue>
          <span className="font-medium">{currentSprint.name}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">{formatDayRange(currentSprint.start_date, currentSprint.end_date)}</span>
        </SelectValue>
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
