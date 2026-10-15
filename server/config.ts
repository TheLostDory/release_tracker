import { z } from 'zod'

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'))

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
