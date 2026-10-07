import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** The app shell works offline (PWA), but data needs the network: say so. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine)
  if (online) return null
  return (
    <div role="status" className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-1.5 text-sm text-amber-900 dark:text-amber-200">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      You're offline. Showing the last loaded data; changes can't be saved until you reconnect.
    </div>
  )
}
