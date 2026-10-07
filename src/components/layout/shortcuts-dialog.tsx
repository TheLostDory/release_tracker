import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SHORTCUT_GROUPS } from './shortcuts'

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are ignored while typing in a field.</DialogDescription>
        </DialogHeader>
        <ShortcutList />
      </DialogContent>
    </Dialog>
  )
}

export function ShortcutList() {
  return (
    <div className="space-y-4">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{group.title}</h3>
          <dl className="divide-y rounded-md border text-sm">
            {group.items.map((item) => (
              <div key={item.label} className="flex items-center justify-between px-3 py-1.5">
                <dt>{item.label}</dt>
                <dd className="flex gap-1">
                  {item.keys.map((k) => (
                    <kbd key={k} className="min-w-5 rounded border bg-muted px-1.5 text-center font-mono text-xs">
                      {k}
                    </kbd>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
