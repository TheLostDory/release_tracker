import { z } from 'zod'

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'))

/** Unset or blank → undefined (compose passes "" for unset variables). */
const optional = <T extends z.ZodType>(t: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), t.optional())

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** Restricted login used for every request (row level security applies). */
  DATABASE_URL: z.string().url(),
  /** Owner login, only for migrations and seeding. */
  DATABASE_OWNER_URL: z.string().url().optional(),
  /** Password given to the restricted login by the migration runner. */
  APP_DB_PASSWORD: z.string().min(12).optional(),
  /** Serve the built frontend from here (production). */
  STATIC_DIR: z.string().optional(),
  COOKIE_SECURE: bool(false),
  SIGNUP_ENABLED: bool(true),
  /** Number of reverse proxies in front (for client IPs and req.secure). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SEED: bool(false),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** 32+ chars; encrypts integration credentials at rest. */
  ENCRYPTION_KEY: z.string().min(32).optional(),

  // --- AI assistant (optional; disabled unless AI_BASE_URL is set) -----------
  /** Request format: Gemini generateContent, or OpenAI-compatible chat completions. */
  AI_FORMAT: z.preprocess((v) => v || undefined, z.enum(['gemini', 'openai']).default('gemini')),
  /** Base URL of the gateway, e.g. https://airelay.company.com */
  AI_BASE_URL: optional(z.string().url()),
  /** Path appended to AI_BASE_URL; {model} is replaced. Defaults per format. */
  AI_PATH: optional(z.string()),
  AI_MODEL: z.preprocess((v) => v || undefined, z.string().default('gemini-2.5-flash')),
  AI_API_KEY: optional(z.string()),
  AI_API_SECRET: optional(z.string()),
  /**
   * Request headers as JSON; {key} and {secret} are replaced, e.g.
   * {"X-App-Key":"{key}","X-App-Secret":"{secret}"}. Defaults per format.
   */
  AI_HEADERS: optional(z.string()),
  /** Company CA certificate (PEM; \\n escapes allowed) for the gateway, if it needs one. */
  AI_CA_CERT: optional(z.string()),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid configuration:\n${problems}`)
  }
  return parsed.data
}
