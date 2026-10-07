import { useEffect } from 'react'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

interface Options {
  onCommandMenu: () => void
  /** Map of second key → handler for "g <key>" sequences. */
  goTo: Record<string, () => void>
  /** Single-key shortcuts, e.g. "c" to create. */
  single?: Record<string, () => void>
}

/** ⌘K / Ctrl+K opens the command menu; "g d", "g s"… navigate; single keys act. */
export function useGlobalShortcuts({ onCommandMenu, goTo, single }: Options) {
  useEffect(() => {
    let pendingG = false
    let timer: number | undefined

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onCommandMenu()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return

      if (pendingG) {
        pendingG = false
        window.clearTimeout(timer)
        const handler = goTo[e.key]
        if (handler) {
          e.preventDefault()
          handler()
        }
        return
      }
      if (e.key === 'g') {
        pendingG = true
        timer = window.setTimeout(() => (pendingG = false), 1000)
        return
      }
      // Don't fire while a dialog/menu has focus.
      if (document.querySelector('[role=dialog],[role=alertdialog],[role=menu]')) return
      const handler = single?.[e.key]
      if (handler) {
        e.preventDefault()
        handler()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(timer)
    }
  }, [onCommandMenu, goTo, single])
}
