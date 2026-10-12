import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  title: string
  description?: ReactNode
  children: ReactNode
  tone?: 'default' | 'danger'
}

export function SettingsSection({ title, description, children, tone = 'default' }: Props) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section
      aria-labelledby={id}
      className={cn('rounded-lg border p-4', tone === 'danger' && 'border-red-500/40')}
    >
      <h2 id={id} className={cn('text-sm font-semibold', tone === 'danger' && 'text-red-700 dark:text-red-400')}>
        {title}
      </h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}
