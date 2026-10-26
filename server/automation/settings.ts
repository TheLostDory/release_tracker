import { z } from 'zod'

/**
 * Per-project automation settings (projects.automation). Everything is
 * optional in storage; `automationSettings()` fills the defaults, so older
 * projects get sensible behaviour without being saved again.
 */
export const STEP_TYPES = [
  'RELEASE_IDENTIFIED',
  'RC_CREATION',
  'AUTOMATED_JOBS',
  'LOAD_TEST_REVIEW',
  'LONGEVITY_REVIEW',
  'HIT_REVIEW',
  'RC_EMAIL',
  'RTP_CREATION',
  'RC_ESCALATION_EMAIL',
  'APPROVAL',
  'RELEASE_EMAIL',
  'DEPLOYMENT',
] as const

export const EMAIL_STEPS = ['RC_EMAIL', 'RC_ESCALATION_EMAIL', 'RELEASE_EMAIL'] as const
export type EmailStep = (typeof EMAIL_STEPS)[number]

/** Days before the target deployment (same as default_step_offsets() in the database). */
export const DEFAULT_OFFSETS: Record<(typeof STEP_TYPES)[number], number> = {
  RELEASE_IDENTIFIED: 21,
  RC_CREATION: 14,
  AUTOMATED_JOBS: 12,
  LOAD_TEST_REVIEW: 9,
  LONGEVITY_REVIEW: 9,
  HIT_REVIEW: 9,
  RC_EMAIL: 7,
  RTP_CREATION: 5,
  RC_ESCALATION_EMAIL: 4,
  APPROVAL: 2,
  RELEASE_EMAIL: 1,
  DEPLOYMENT: 0,
}

const emails = z.string().trim().max(2000)
const recipients = z.strictObject({ to: emails, cc: emails })

export const automationSchema = z.strictObject({
  planDates: z.strictObject({
    enabled: z.boolean(),
    offsets: z.record(z.enum(STEP_TYPES), z.number().int().min(0).max(365)),
  }),
  emails: z.strictObject({
    recipients: z.strictObject({ RC_EMAIL: recipients, RC_ESCALATION_EMAIL: recipients, RELEASE_EMAIL: recipients }),
  }),
  jenkins: z.strictObject({
    /** Start the jobs when RC creation completes. */
    autoStart: z.boolean(),
    jobs: z
      .array(
        z.strictObject({
          purpose: z.enum(['LOAD_TEST', 'LONGEVITY', 'HIT', 'AUTOMATED']),
          jobPath: z.string().trim().min(1).max(300),
          parameters: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/), z.string().max(500)),
        }),
      )
      .max(20),
  }),
  autoComplete: z.strictObject({
    /** RC creation completes when the RC branch exists on GitHub. */
    rcCreationFromGithub: z.boolean(),
    /** Deployment completes when the Jira version is released. */
    deploymentFromJira: z.boolean(),
  }),
  jiraSync: z.strictObject({
    /** New unreleased Jira versions become releases. */
    importVersions: z.boolean(),
    /** Target dates follow the Jira versions' release dates. */
    syncDates: z.boolean(),
  }),
  codeCheck: z.strictObject({
    /** Re-run Code vs Jira hourly for open releases (Teams alert on new differences). */
    background: z.boolean(),
  }),
})

export type AutomationSettings = z.infer<typeof automationSchema>

const noRecipients = { to: '', cc: '' }

export const DEFAULT_AUTOMATION: AutomationSettings = {
  planDates: { enabled: true, offsets: { ...DEFAULT_OFFSETS } },
  emails: { recipients: { RC_EMAIL: noRecipients, RC_ESCALATION_EMAIL: noRecipients, RELEASE_EMAIL: noRecipients } },
  jenkins: { autoStart: false, jobs: [] },
  autoComplete: { rcCreationFromGithub: true, deploymentFromJira: true },
  jiraSync: { importVersions: false, syncDates: true },
  codeCheck: { background: true },
}

/** Stored (possibly partial or older) settings → complete settings. */
export function automationSettings(stored: unknown): AutomationSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof AutomationSettings, Record<string, unknown>>>
  const d = DEFAULT_AUTOMATION
  return {
    planDates: { ...d.planDates, ...s.planDates, offsets: { ...d.planDates.offsets, ...(s.planDates?.offsets as object) } },
    emails: { recipients: { ...d.emails.recipients, ...(s.emails?.recipients as object) } },
    jenkins: { ...d.jenkins, ...s.jenkins },
    autoComplete: { ...d.autoComplete, ...s.autoComplete },
    jiraSync: { ...d.jiraSync, ...s.jiraSync },
    codeCheck: { ...d.codeCheck, ...s.codeCheck },
  } as AutomationSettings
}
