import { useSyncExternalStore } from 'react'
import { addDays, startOfDay } from 'date-fns'
import { toDayString, type DayString } from '@/lib/dates'

/** Re-renders subscribers when the local calendar day changes. */
function subscribe(onChange: () => void) {
  let timer: number
  const schedule = () => {
    const msToMidnight = addDays(startOfDay(new Date()), 1).getTime() - Date.now()
    timer = window.setTimeout(() => {
      onChange()
      schedule()
    }, msToMidnight + 1000)
  }
  schedule()
  // Laptops waking from sleep skip timers; re-check on focus.
  window.addEventListener('focus', onChange)
  return () => {
    window.clearTimeout(timer)
    window.removeEventListener('focus', onChange)
  }
}

/** Today's local calendar day; stable within a day, updates at midnight. */
export function useToday(): DayString {
  return useSyncExternalStore(subscribe, () => toDayString(new Date()))
}
