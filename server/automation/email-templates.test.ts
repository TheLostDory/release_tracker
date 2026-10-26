import { describe, expect, it } from 'vitest'
import { buildEmailDraft, longDate, type EmailData } from './email-templates.js'

const data = (over: Partial<EmailData> = {}): EmailData => ({
  appUrl: 'http://localhost:8800',
  release: { id: 'r1', name: 'RC_7', version: '7.0.0', targetDate: '2026-12-15', deployedDate: null, sprint: 'SP_III_2026-12-01', owner: 'Charbel' },
  jira: {
    versionName: '7.0.0',
    url: 'https://jira/projects/ABC/versions/1',
    issues: [
      { key: 'ABC-1', summary: 'Login with SSO', type: 'Story', status: 'Done', url: 'https://jira/browse/ABC-1' },
      { key: 'ABC-2', summary: 'Crash <on> start', type: 'Bug', status: 'Done', url: 'https://jira/browse/ABC-2' },
    ],
  },
  runs: [{ label: 'Longevity', name: 'perf » longevity #21', result: 'SUCCESS', building: false, url: 'https://ci/job/perf/job/longevity/21/', reportUrl: null }],
  reports: [
    { type: 'LONGEVITY', result: 'PASS', url: 'https://ci/job/perf/job/longevity/21/' },
    { type: 'HIT', result: 'NOT_REVIEWED', url: null },
  ],
  codeCheck: { jiraOnly: 0, codeOnly: 0, noKey: 0, matched: 2 },
  openItems: ['Approval: waiting since Dec 10'],
  approval: { status: 'PENDING', dueDate: '2026-12-11' },
  ...over,
})

describe('email drafts', () => {
  it('RC email: content, test results, code check, link', () => {
    const d = buildEmailDraft('RC_EMAIL', data())
    expect(d.subject).toBe('RC_7 (7.0.0) is ready')
    expect(buildEmailDraft('RC_EMAIL', data({ release: { ...data().release, name: 'Spring' } })).subject).toBe('RC Spring (7.0.0) is ready')
    expect(d.text).toContain('Target deployment: Tue, Dec 15, 2026 (SP_III_2026-12-01).')
    expect(d.text).toContain('What it contains (2: 1 story, 1 bug)')
    expect(d.text).toContain('  - ABC-1 Login with SSO (Story) https://jira/browse/ABC-1')
    expect(d.text).toContain('  - Longevity: success (perf » longevity #21) https://ci/job/perf/job/longevity/21/')
    expect(d.text).toContain('  - HIT: Not reviewed yet')
    expect(d.text).not.toContain('Longevity: Pass') // the run already covers it
    expect(d.text).toContain('Code vs Jira: what was merged into the RC matches the Jira version (2 issues).')
    expect(d.text).toContain('Release details: http://localhost:8800/releases/r1')
    // HTML is escaped and linked.
    expect(d.html).toContain('<a href="https://jira/browse/ABC-2">ABC-2 Crash &lt;on&gt; start</a>')
  })

  it('escalation email: deadline, approval status and what is still open', () => {
    const d = buildEmailDraft('RC_ESCALATION_EMAIL', data({ codeCheck: { jiraOnly: 3, codeOnly: 1, noKey: 0, matched: 9 } }))
    expect(d.subject).toBe('Action needed: approval for RC_7 (7.0.0)')
    expect(d.text).toContain('RC_7 (7.0.0) needs approval by Fri, Dec 11, 2026 to deploy on Tue, Dec 15, 2026. Approval status: pending.')
    expect(d.text).toContain('Still open\n\n  - Approval: waiting since Dec 10')
    expect(d.text).toContain('Code vs Jira: 4 differences (3 in Jira not merged, 1 merged not in the version, 0 merged without an issue).')
  })

  it('release email: past or future tense, and works without Jira', () => {
    expect(buildEmailDraft('RELEASE_EMAIL', data()).text).toContain('RC_7 (7.0.0) will be deployed on Tue, Dec 15, 2026.')
    const released = buildEmailDraft('RELEASE_EMAIL', data({ jira: null, release: { ...data().release, deployedDate: '2026-12-16' } }))
    expect(released.subject).toBe('Released: RC_7 (7.0.0)')
    expect(released.text).toContain('was deployed on Wed, Dec 16, 2026.')
    expect(released.text).not.toContain("What's included")
  })

  it('formats dates without time zone surprises', () => {
    expect(longDate('2026-01-01')).toBe('Thu, Jan 1, 2026')
  })
})
