import type { ReactNode } from 'react'
import { Rocket } from 'lucide-react'
import { PageTitle } from '@/components/page-title'

/** Shared frame for sign-in / sign-up. */
export function AuthCard({ title, subtitle, pageTitle, children, footer }: {
  title: string
  subtitle?: ReactNode
  pageTitle: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-8">
      <PageTitle title={pageTitle} />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Rocket className="size-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Release Tracker</span>
        </div>
        <div className="space-y-4 rounded-lg border bg-background p-6">
          <div>
            <h1 className="text-base font-semibold">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
        </div>
        {footer && <p className="mt-4 text-center text-sm text-muted-foreground">{footer}</p>}
      </div>
    </div>
  )
}
