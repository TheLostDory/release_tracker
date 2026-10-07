import { useState, type FormEvent } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { FormField } from '@/components/form-field'
import { ShortcutList } from '@/components/layout/shortcuts-dialog'
import { PageHeader } from '@/components/page-header'
import { PageTitle } from '@/components/page-title'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-context'
import { useProfiles, useUpdateMyName } from '@/features/profiles/queries'
import { useTheme } from '@/hooks/use-theme'
import type { ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { toUserMessage } from '@/lib/supabase-errors'

export default function SettingsPage() {
  return (
    <>
      <PageTitle title="Settings" />
      <PageHeader title="Settings" />
      <div className="grid max-w-4xl gap-8 lg:grid-cols-2">
        <section aria-labelledby="profile-heading" className="space-y-3">
          <h2 id="profile-heading" className="text-sm font-medium">
            Profile
          </h2>
          <ProfileForm />
          <h2 id="appearance-heading" className="pt-4 text-sm font-medium">
            Appearance
          </h2>
          <ThemePicker />
        </section>
        <section aria-labelledby="shortcuts-heading" className="space-y-3">
          <h2 id="shortcuts-heading" className="text-sm font-medium">
            Keyboard shortcuts
          </h2>
          <ShortcutList />
        </section>
      </div>
    </>
  )
}

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

function ThemePicker() {
  const { preference, setPreference } = useTheme()
  return (
    <div role="radiogroup" aria-labelledby="appearance-heading" className="grid grid-cols-3 gap-2">
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          onClick={() => setPreference(value)}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/60',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            preference === value && 'border-foreground/50 bg-muted/60 font-medium',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}

function ProfileForm() {
  const { user } = useAuth()
  const { data: profiles, isLoading } = useProfiles()
  const me = profiles?.find((p) => p.id === user?.id)
  if (isLoading || !user) return <div className="h-40 animate-pulse rounded-lg bg-muted/50" />
  return <ProfileFormInner key={me?.name} userId={user.id} email={user.email ?? ''} initialName={me?.name ?? ''} />
}

function ProfileFormInner({ userId, email, initialName }: { userId: string; email: string; initialName: string }) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string>()
  const update = useUpdateMyName()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Name is required.')
    if (trimmed.length > 80) return setError('Keep it under 80 characters.')
    try {
      await update.mutateAsync({ id: userId, name: trimmed })
      toast.success('Profile updated')
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border p-4">
      <FormField label="Display name" error={error} hint="Shown as owner, reviewer and in the activity log.">
        {(p) => (
          <Input
            {...p}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(undefined)
            }}
          />
        )}
      </FormField>
      <FormField label="Email" hint="Managed by your administrator.">
        {(p) => <Input {...p} value={email} readOnly disabled />}
      </FormField>
      <Button type="submit" size="sm" disabled={update.isPending || name.trim() === initialName}>
        {update.isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
