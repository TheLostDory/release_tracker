import type { EmailStep } from './settings.js'

/**
 * Email drafts for the RC email, RC escalation email and release email,
 * from what the tracker knows about the release. Pure: the route gathers the
 * data. Plain text for mail links, HTML for pasting into Outlook.
 */
export interface EmailData {
  appUrl: string
  release: {
    id: string
    name: string
    version: string
    targetDate: string
    deployedDate: string | null
    sprint: string | null
    owner: string | null
  }
  /** Issues in the release's Jira version; null when not linked or Jira isn't connected. */
  jira: { versionName: string; url: string; issues: { key: string; summary: string; type: string; status: string; url: string }[] } | null
  /** Jenkins runs added to the Automated jobs step. */
  runs: { label: string; name: string; result: string | null; building: boolean; url: string; reportUrl: string | null }[]
  reports: { type: string; result: string; url: string | null }[]
  codeCheck: { jiraOnly: number; codeOnly: number; noKey: number; matched: number } | null
  /** Blocked or overdue steps, approval state… */
  openItems: string[]
  approval: { status: string; dueDate: string | null } | null
}

export interface EmailDraft {
  subject: string
  text: string
  html: string
}

const REPORT_LABEL: Record<string, string> = { LOAD_TEST: 'Load Test', LONGEVITY: 'Longevity', HIT: 'HIT' }
const RESULT_LABEL: Record<string, string> = { PASS: 'Pass', WARNING: 'Warning', FAIL: 'Fail', NOT_REVIEWED: 'Not reviewed yet' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** "Tue, Dec 15, 2026" from "2026-12-15" (no time zone shifts). */
export function longDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** A document built once, rendered as text and as HTML. */
type Block = { kind: 'p'; text: string } | { kind: 'h'; text: string } | { kind: 'list'; items: { text: string; href?: string; note?: string }[] }

function render(blocks: Block[]): { text: string; html: string } {
  const text = blocks
    .map((b) =>
      b.kind === 'list'
        ? b.items.map((i) => `  - ${i.text}${i.note ? ` (${i.note})` : ''}${i.href ? ` ${i.href}` : ''}`).join('\n')
        : b.kind === 'h'
          ? `${b.text}`
          : b.text,
    )
    .join('\n\n')
  const html = blocks
    .map((b) =>
      b.kind === 'list'
        ? `<ul>${b.items.map((i) => `<li>${i.href ? `<a href="${esc(i.href)}">${esc(i.text)}</a>` : esc(i.text)}${i.note ? ` <span style="color:#666">(${esc(i.note)})</span>` : ''}</li>`).join('')}</ul>`
        : b.kind === 'h'
          ? `<p><strong>${esc(b.text)}</strong></p>`
          : `<p>${esc(b.text).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n')
  return { text, html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">${html}</div>` }
}

function contentBlocks(d: EmailData, heading: string): Block[] {
  if (!d.jira) return []
  const issues = d.jira.issues
  if (issues.length === 0) return [{ kind: 'h', text: heading }, { kind: 'p', text: `No issues in Jira version ${d.jira.versionName}.` }]
  const byType = new Map<string, typeof issues>()
  for (const i of issues) byType.set(i.type, [...(byType.get(i.type) ?? []), i])
  const counts = [...byType].map(([t, list]) => `${list.length} ${t.toLowerCase()}${list.length === 1 ? '' : 's'}`).join(', ')
  return [
    { kind: 'h', text: `${heading} (${issues.length}: ${counts})` },
    { kind: 'list', items: issues.slice(0, 60).map((i) => ({ text: `${i.key} ${i.summary}`, href: i.url, note: i.type })) },
    ...(issues.length > 60 ? [{ kind: 'p' as const, text: `…and ${issues.length - 60} more in Jira version ${d.jira.versionName}: ${d.jira.url}` }] : []),
  ]
}

function testBlocks(d: EmailData): Block[] {
  const items = [
    ...d.runs.map((r) => ({
      text: `${r.label}: ${r.building ? 'running' : (r.result ?? 'unknown').toLowerCase()}`,
      href: r.reportUrl ?? r.url,
      note: r.name,
    })),
    ...d.reports
      .filter((rep) => !d.runs.some((r) => r.label === REPORT_LABEL[rep.type]))
      .map((rep) => ({ text: `${REPORT_LABEL[rep.type] ?? rep.type}: ${RESULT_LABEL[rep.result] ?? rep.result}`, href: rep.url ?? undefined })),
  ]
  return items.length ? [{ kind: 'h', text: 'Test results' }, { kind: 'list', items }] : []
}

function codeBlock(d: EmailData): Block[] {
  const c = d.codeCheck
  if (!c) return []
  const diffs = c.jiraOnly + c.codeOnly + c.noKey
  return [
    {
      kind: 'p',
      text:
        diffs === 0
          ? `Code vs Jira: what was merged into the RC matches the Jira version (${c.matched} issues).`
          : `Code vs Jira: ${diffs} difference${diffs === 1 ? '' : 's'} (${c.jiraOnly} in Jira not merged, ${c.codeOnly} merged not in the version, ${c.noKey} merged without an issue).`,
    },
  ]
}

const link = (d: EmailData) => `${d.appUrl.replace(/\/+$/, '')}/releases/${d.release.id}`

export function buildEmailDraft(step: EmailStep, d: EmailData): EmailDraft {
  const r = d.release
  const title = `${r.name} (${r.version})`
  let subject: string
  let blocks: Block[]

  if (step === 'RC_EMAIL') {
    // "RC_7 (7.0.0) is ready", not "RC RC_7…" when the name already says RC.
    subject = `${/^rc(\b|_|-)/i.test(r.name) ? '' : 'RC '}${title} is ready`
    blocks = [
      { kind: 'p', text: 'Hi all,' },
      {
        kind: 'p',
        text: `The release candidate ${title} is ready. Target deployment: ${longDate(r.targetDate)}${r.sprint ? ` (${r.sprint})` : ''}.`,
      },
      ...contentBlocks(d, 'What it contains'),
      ...testBlocks(d),
      ...codeBlock(d),
      { kind: 'p', text: `Release details: ${link(d)}` },
      { kind: 'p', text: `Regards,\n${r.owner ?? ''}`.trim() },
    ]
  } else if (step === 'RC_ESCALATION_EMAIL') {
    const due = d.approval?.dueDate
    subject = `Action needed: approval for ${title}`
    blocks = [
      { kind: 'p', text: 'Hi all,' },
      {
        kind: 'p',
        text: `${title} needs approval${due ? ` by ${longDate(due)}` : ''} to deploy on ${longDate(r.targetDate)}.${d.approval ? ` Approval status: ${d.approval.status.toLowerCase()}.` : ''}`,
      },
      ...(d.openItems.length ? [{ kind: 'h' as const, text: 'Still open' }, { kind: 'list' as const, items: d.openItems.map((t) => ({ text: t })) }] : []),
      ...testBlocks(d),
      ...codeBlock(d),
      { kind: 'p', text: `Release details: ${link(d)}` },
      { kind: 'p', text: `Regards,\n${r.owner ?? ''}`.trim() },
    ]
  } else {
    const when = r.deployedDate ?? r.targetDate
    subject = `${r.deployedDate ? 'Released' : 'Releasing'}: ${title}`
    blocks = [
      { kind: 'p', text: 'Hi all,' },
      {
        kind: 'p',
        text: r.deployedDate ? `${title} was deployed on ${longDate(when)}.` : `${title} will be deployed on ${longDate(when)}.`,
      },
      ...contentBlocks(d, "What's included"),
      { kind: 'p', text: `Release details: ${link(d)}` },
      { kind: 'p', text: `Regards,\n${r.owner ?? ''}`.trim() },
    ]
  }
  return { subject, ...render(blocks) }
}
