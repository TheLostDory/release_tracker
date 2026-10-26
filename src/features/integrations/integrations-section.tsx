import { useState, type FormEvent } from 'react'
import { CheckCircle2, ExternalLink, Plug, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { FormField } from '@/components/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsSection } from '@/features/projects/settings/settings-section'
import type { Project } from '@/features/projects/api'
import { formatTimestamp } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { inspectCertificate, type Integration, type IntegrationAuth, type IntegrationKind, type PresentedCertificate, type TeamsSettings } from './api'
import { useDeleteIntegration, useIntegrations, useSaveIntegration, useTestIntegration } from './queries'

const LABELS: Record<IntegrationKind, string> = { JIRA: 'Jira', JENKINS: 'Jenkins', GITHUB: 'GitHub', TEAMS: 'Microsoft Teams' }

const DEFAULT_AUTH: Record<IntegrationKind, IntegrationAuth> = { JIRA: 'JIRA_CLOUD', JENKINS: 'JENKINS', GITHUB: 'GITHUB', TEAMS: 'TEAMS' }

const TEAMS_EVENTS: { key: keyof TeamsSettings['events']; label: string; hint: string }[] = [
  { key: 'blocked', label: 'Blocked steps', hint: 'A step becomes blocked, with the reason.' },
  { key: 'jenkins', label: 'Jenkins jobs finished', hint: 'A Load Test, Longevity, HIT or other job finished, with its result.' },
  { key: 'code', label: 'Code vs Jira differences', hint: 'When a release’s comparison finds more differences than before.' },
  { key: 'dueSoon', label: 'Due tomorrow', hint: 'Each morning (at the summary time): steps due on the next working day, with their owners.' },
  { key: 'approval', label: 'Approval needed', hint: 'When approval is requested: the deadline and what’s still open.' },
  { key: 'daily', label: 'Daily summary', hint: 'The dashboard’s Action required list, once a day.' },
]

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const originOf = (url: string) => {
  try {
    return new URL(url.trim()).origin
  } catch {
    return null
  }
}

/** "Blocked steps · Jenkins jobs finished · Daily summary at 09:00 (Mon–Fri, Europe/Paris)". */
function teamsSummary(t: Partial<TeamsSettings>): string {
  const events = TEAMS_EVENTS.filter((e) => t.events?.[e.key] ?? true)
  if (events.length === 0) return 'Nothing (all notifications are off)'
  return events
    .map((e) => (e.key === 'daily' ? `Daily summary at ${t.dailyTime ?? '09:00'} (${t.weekdaysOnly === false ? 'every day' : 'Mon–Fri'}, ${t.timezone ?? 'UTC'})` : e.label))
    .join(' · ')
}

/** The GitHub API address as people know it: https://api.github.com → https://github.com. */
const githubWebUrl = (apiUrl: string) => (apiUrl === 'https://api.github.com' ? 'https://github.com' : apiUrl.replace(/\/api\/v3$/, ''))

export function IntegrationsSection({ project, canManage }: { project: Project; canManage: boolean }) {
  const { data = [], isLoading } = useIntegrations(project.id)
  return (
    <SettingsSection
      title="Integrations"
      description="Credentials are encrypted on the server and never shown again. Only admins and owners can change them."
    >
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-muted/50" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(['JIRA', 'JENKINS', 'GITHUB', 'TEAMS'] as const).map((kind) => (
            <IntegrationCard
              key={kind}
              kind={kind}
              projectId={project.id}
              integration={data.find((i) => i.kind === kind) ?? null}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  )
}

function IntegrationCard({
  kind,
  projectId,
  integration,
  canManage,
}: {
  kind: IntegrationKind
  projectId: string
  integration: Integration | null
  canManage: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const test = useTestIntegration(projectId)
  const remove = useDeleteIntegration(projectId)
  const label = LABELS[kind]

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Plug className="size-4 text-muted-foreground" aria-hidden />
          {label}
        </h3>
        {integration ? (
          integration.last_error ? (
            <Badge className="bg-red-500/10 font-normal text-red-700 dark:text-red-400">
              <TriangleAlert aria-hidden /> Error
            </Badge>
          ) : (
            <Badge className="bg-emerald-500/10 font-normal text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 aria-hidden /> Connected
            </Badge>
          )
        ) : (
          <Badge variant="secondary" className="font-normal">
            Not connected
          </Badge>
        )}
      </div>

      {integration && !editing && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {kind === 'TEAMS' ? (
            <>
              <dt className="text-muted-foreground">Sends</dt>
              <dd>{teamsSummary(integration.settings)}</dd>
            </>
          ) : (
            <dt className="text-muted-foreground">URL</dt>
          )}
          <dd className={cn('truncate', kind === 'TEAMS' && 'hidden')}>
            <a href={kind === 'GITHUB' ? githubWebUrl(integration.base_url) : integration.base_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {kind === 'GITHUB' ? githubWebUrl(integration.base_url) : integration.base_url} <ExternalLink className="inline size-3" aria-hidden />
            </a>
          </dd>
          {kind === 'JIRA' && (
            <>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{integration.auth_type === 'JIRA_CLOUD' ? 'Jira Cloud' : 'Jira Server / Data Center'}</dd>
              <dt className="text-muted-foreground">Project</dt>
              <dd className="font-mono">{integration.settings.projectKey}</dd>
            </>
          )}
          {kind === 'GITHUB' && (
            <>
              <dt className="text-muted-foreground">Repositories</dt>
              <dd className="min-w-0 font-mono text-xs leading-5 break-all">{(integration.settings.repos ?? []).join(', ')}</dd>
              <dt className="text-muted-foreground">RC branch</dt>
              <dd className="font-mono text-xs leading-5">{integration.settings.headTemplate ?? 'release/{{version}}'}</dd>
            </>
          )}
          {integration.username && (
            <>
              <dt className="text-muted-foreground">{kind === 'JIRA' ? 'Account' : 'User'}</dt>
              <dd className="truncate">{integration.username}</dd>
            </>
          )}
          {integration.ca_cert && (
            <>
              <dt className="text-muted-foreground">HTTPS</dt>
              <dd>Company certificate trusted</dd>
            </>
          )}
          {integration.last_checked_at && (
            <>
              <dt className="text-muted-foreground">Checked</dt>
              <dd>{formatTimestamp(integration.last_checked_at)}</dd>
            </>
          )}
          {integration.last_error && <dd className="col-span-2 text-xs text-red-600 dark:text-red-400">{integration.last_error}</dd>}
        </dl>
      )}

      {!integration && !editing && (
        <p className="text-sm text-muted-foreground">
          {kind === 'JIRA'
            ? 'Import Jira versions as releases and see each version’s tasks and bugs.'
            : kind === 'TEAMS'
              ? 'Post blocked steps, finished Jenkins jobs and a daily summary to a Teams channel.'
              : kind === 'GITHUB'
              ? 'Compare what was merged into each release candidate with the issues in its Jira version.'
              : 'Link Jenkins jobs to releases: drive the Automated jobs step, show builds, run jobs, fill report links.'}
        </p>
      )}

      {editing ? (
        <IntegrationForm kind={kind} projectId={projectId} integration={integration} onDone={() => setEditing(false)} />
      ) : (
        canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={integration ? 'outline' : 'default'} onClick={() => setEditing(true)}>
              {integration ? 'Edit' : `Connect ${label}`}
            </Button>
            {integration && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={test.isPending}
                  onClick={() =>
                    test.mutate(kind, {
                      onSuccess: (r) => toast.success(r.message),
                      onError: (err) => toast.error(toUserMessage(err)),
                    })
                  }
                >
                  {test.isPending ? 'Testing…' : 'Test connection'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                  Disconnect
                </Button>
              </>
            )}
          </div>
        )
      )}

      <ConfirmDeleteDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Disconnect ${label}?`}
        description={
          kind === 'JENKINS'
            ? 'Linked jobs stay on releases but stop syncing until you connect again. The stored token is deleted.'
            : kind === 'TEAMS'
              ? 'No more messages are posted to the channel. The stored webhook URL is deleted.'
              : kind === 'GITHUB'
              ? 'Releases keep their chosen branches, but comparisons won’t run until you connect again. The stored token is deleted.'
              : 'Releases keep their Jira version link but issues won’t load until you connect again. The stored token is deleted.'
        }
        confirmLabel="Disconnect"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(kind, {
            onSuccess: () => {
              toast.success(`${label} disconnected`)
              setConfirmRemove(false)
            },
            onError: (err) => toast.error(toUserMessage(err)),
          })
        }
      />
    </div>
  )
}

function IntegrationForm({
  kind,
  projectId,
  integration,
  onDone,
}: {
  kind: IntegrationKind
  projectId: string
  integration: Integration | null
  onDone: () => void
}) {
  const save = useSaveIntegration(projectId)
  const [authType, setAuthType] = useState<IntegrationAuth>(integration?.auth_type ?? DEFAULT_AUTH[kind])
  const [baseUrl, setBaseUrl] = useState(
    integration ? (kind === 'GITHUB' ? githubWebUrl(integration.base_url) : integration.base_url) : kind === 'GITHUB' ? 'https://github.com' : '',
  )
  const [repos, setRepos] = useState((integration?.settings.repos ?? []).join('\n'))
  const [headTemplate, setHeadTemplate] = useState(integration?.settings.headTemplate ?? 'release/{{version}}')
  const [teams, setTeams] = useState<TeamsSettings>(() => ({
    events: { blocked: true, jenkins: true, daily: true, code: true, dueSoon: true, approval: true, ...integration?.settings.events },
    dailyTime: integration?.settings.dailyTime ?? '09:00',
    // Times are in the admin's time zone (the server runs in UTC).
    timezone: browserTimeZone(),
    weekdaysOnly: integration?.settings.weekdaysOnly ?? true,
  }))
  const [username, setUsername] = useState(integration?.username ?? '')
  const [secret, setSecret] = useState('')
  const [projectKey, setProjectKey] = useState(integration?.settings.projectKey ?? '')
  // undefined = unchanged; '' = remove; text = new certificate.
  const [caCert, setCaCert] = useState<string | undefined>(undefined)
  const [showCa, setShowCa] = useState(false)
  const [fetched, setFetched] = useState<{ host: string; cert: PresentedCertificate } | null>(null)
  const [fetching, setFetching] = useState(false)

  async function fetchCertificate() {
    setFetching(true)
    setError(null)
    try {
      const target = kind === 'TEAMS' ? originOf(secret) ?? integration?.base_url ?? '' : baseUrl.trim()
      const r = await inspectCertificate(projectId, target)
      const cert = r.certificates[r.recommended]
      if (cert) setFetched({ host: r.host, cert })
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setFetching(false)
    }
  }
  const [error, setError] = useState<string | null>(null)
  const cloud = authType === 'JIRA_CLOUD'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const result = await save.mutateAsync({
        kind,
        input: {
          authType,
          baseUrl: baseUrl.trim(),
          username: kind === 'JENKINS' || cloud ? username.trim() || null : null,
          ...(secret ? { secret } : {}),
          ...(kind === 'JIRA' ? { projectKey: projectKey.trim().toUpperCase() } : {}),
          ...(kind === 'TEAMS' ? { teams } : {}),
          ...(kind === 'GITHUB'
            ? {
                repos: repos
                  .split(/[\s,]+/)
                  .map((r) => r.trim().replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '').replace(/\/+$/, ''))
                  .filter(Boolean),
                headTemplate: headTemplate.trim(),
              }
            : {}),
          ...(caCert !== undefined ? { caCert } : {}),
        },
      })
      toast.success(result.message)
      onDone()
    } catch (err) {
      const message = toUserMessage(err)
      setError(message)
      // Certificate problem: open the certificate section to fix it right away.
      if (/certificate|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(message)) setShowCa(true)
    }
  }

  const tokenLabel = kind === 'TEAMS' ? 'Webhook URL' : kind === 'GITHUB' ? 'Access token' : kind === 'JENKINS' ? 'API token' : cloud ? 'API token' : 'Personal access token'
  const tokenHint =
    kind === 'TEAMS'
      ? 'In Teams: the channel’s ⋯ → Workflows → “Post to a channel when a webhook request is received”, then copy the URL it gives you.'
      : kind === 'GITHUB'
      ? 'GitHub → Settings → Developer settings → Personal access tokens. Read access to contents and pull requests is enough.'
      : kind === 'JENKINS'
      ? 'Jenkins → your user → Security → API Token.'
      : cloud
        ? 'id.atlassian.com → Security → API tokens.'
        : 'Jira → your profile → Personal Access Tokens.'

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      {kind === 'JIRA' && (
        <FormField label="Jira type">
          {(p) => (
            <Select value={authType} onValueChange={(v) => setAuthType(v as IntegrationAuth)}>
              <SelectTrigger {...p} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="JIRA_CLOUD">Jira Cloud (something.atlassian.net)</SelectItem>
                <SelectItem value="JIRA_SERVER">Jira Server / Data Center (self-hosted)</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}
      {kind !== 'TEAMS' && (
      <FormField
        label={`${LABELS[kind]} URL`}
        hint={
          kind === 'JIRA'
            ? 'e.g. https://yourcompany.atlassian.net'
            : kind === 'GITHUB'
              ? 'https://github.com, or your GitHub Enterprise address (e.g. https://github.yourcompany.com).'
              : 'e.g. https://jenkins.yourcompany.com'
        }
      >
        {(p) => <Input {...p} type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />}
      </FormField>
      )}
      {(kind === 'JENKINS' || (kind === 'JIRA' && cloud)) && (
        <FormField label={kind === 'JIRA' ? 'Account email' : 'User name'}>
          {(p) => <Input {...p} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />}
        </FormField>
      )}
      <FormField label={tokenLabel} hint={integration ? 'Leave empty to keep the current token.' : tokenHint}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            placeholder={integration ? '•••••••• (unchanged)' : ''}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        )}
      </FormField>
      {kind === 'JIRA' && (
        <FormField label="Jira project key" hint="The prefix of issue keys, e.g. ABC for ABC-123.">
          {(p) => <Input {...p} className="font-mono uppercase" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} />}
        </FormField>
      )}
      {kind === 'GITHUB' && (
        <>
          <FormField label="Repositories" hint="One per line, as owner/name (or paste the repository's link).">
            {(p) => (
              <textarea
                {...p}
                rows={3}
                spellCheck={false}
                className="w-full rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={'acme/backend\nacme/web-app'}
                value={repos}
                onChange={(e) => setRepos(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="RC branch or tag" hint="Suggested for each release; {{version}} and {{name}} are filled in. Each release can change it.">
            {(p) => <Input {...p} className="font-mono" value={headTemplate} onChange={(e) => setHeadTemplate(e.target.value)} placeholder="release/{{version}}" />}
          </FormField>
        </>
      )}
      {kind === 'TEAMS' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Send</legend>
          {TEAMS_EVENTS.map((e) => (
            <label key={e.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-foreground"
                checked={teams.events[e.key] ?? true}
                onChange={(ev) => setTeams((t) => ({ ...t, events: { ...t.events, [e.key]: ev.target.checked } }))}
              />
              <span>
                {e.label}
                <span className="block text-xs text-muted-foreground">{e.hint}</span>
              </span>
            </label>
          ))}
          {teams.events.daily && (
            <div className="flex flex-wrap items-center gap-3 pl-6 text-sm">
              <label className="flex items-center gap-2">
                at
                <Input type="time" className="h-8 w-36" value={teams.dailyTime} onChange={(e) => setTeams((t) => ({ ...t, dailyTime: e.target.value }))} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-foreground" checked={teams.weekdaysOnly} onChange={(e) => setTeams((t) => ({ ...t, weekdaysOnly: e.target.checked }))} />
                Weekdays only
              </label>
              <span className="text-xs text-muted-foreground">({teams.timezone})</span>
            </div>
          )}
        </fieldset>
      )}
      <div className="rounded-md border border-dashed p-2">
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={showCa || !!integration?.ca_cert}
          onClick={() => setShowCa((v) => !v)}
        >
          {showCa ? '▾' : '▸'} Company HTTPS certificate {integration?.ca_cert ? '(installed)' : '(optional)'}
        </button>
        {showCa && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Needed when {LABELS[kind]} uses your company’s own certificate authority (errors like
              “SELF_SIGNED_CERT_IN_CHAIN”). Get it from the server below, or paste it (PEM). It is trusted only for this
              connection; normal certificate checks stay on.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={fetching || (kind === 'TEAMS' ? !secret.trim() && !integration : !/^https:\/\//i.test(baseUrl.trim()))}
              onClick={() => void fetchCertificate()}
            >
              {fetching ? 'Reading certificate…' : `Get certificate from ${LABELS[kind]}`}
            </Button>
            {fetched && (
              <div className="space-y-2 rounded-md bg-muted/50 p-2 text-xs">
                <p>
                  <span className="font-medium">{fetched.host}</span> is signed by:
                </p>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                  <dt className="text-muted-foreground">Certificate</dt>
                  <dd className="font-medium">{fetched.cert.subject}</dd>
                  <dt className="text-muted-foreground">Issued by</dt>
                  <dd>{fetched.cert.issuer}{fetched.cert.selfSigned && ' (root)'}</dd>
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd>{formatTimestamp(fetched.cert.validTo, 'MMM d, yyyy')}</dd>
                  <dt className="text-muted-foreground">Fingerprint</dt>
                  <dd className="font-mono break-all">{fetched.cert.fingerprint256}</dd>
                </dl>
                <p className="text-muted-foreground">
                  Trust it only if this is your company’s certificate authority (the name usually contains your company).
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => {
                      setCaCert(fetched.cert.pem)
                      setFetched(null)
                      toast.success('Certificate added. Click “Test & save”.')
                    }}
                  >
                    Trust this certificate
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setFetched(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <textarea
              aria-label="Company HTTPS certificate (PEM)"
              rows={5}
              spellCheck={false}
              className="w-full rounded-md border bg-background p-2 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={integration?.ca_cert ? '(installed: leave empty to keep it)' : '-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
              value={caCert ?? ''}
              onChange={(e) => setCaCert(e.target.value)}
            />
            {integration?.ca_cert && (
              <Button type="button" size="xs" variant="ghost" onClick={() => setCaCert('')}>
                Remove installed certificate on save
              </Button>
            )}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? 'Testing connection…' : 'Test & save'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
