/**
 * Applies server/db/migrations/*.sql in order (once each), gives the
 * restricted app login its password, and optionally loads the demo seed.
 * Runs with the owner login (DATABASE_OWNER_URL).
 *
 *   node dist-server/server/db/migrate.js          (or: npm run db:migrate)
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { hashPassword } from '../auth/password.js'
import { loadConfig } from '../config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// SQL files live next to the source; the compiled runner (dist-server/server/db)
// reads them from the source tree.
const sqlDir = here.includes(`${path.sep}dist-server${path.sep}`) ? path.resolve(here, '../../../server/db') : here

export async function migrate(ownerUrl: string, opts: { appPassword?: string; seed?: boolean; log?: (m: string) => void }) {
  const log = opts.log ?? ((m: string) => console.log(`[migrate] ${m}`))
  const client = new pg.Client({ connectionString: ownerUrl })
  await client.connect()
  try {
    // One migrator at a time (e.g. several containers starting together).
    await client.query('select pg_advisory_lock(727274)')
    await client.query(`create table if not exists schema_migrations (
      version text primary key, applied_at timestamptz not null default now())`)
    await client.query(`create table if not exists seed_runs (
      name text primary key, applied_at timestamptz not null default now())`)

    const dir = path.join(sqlDir, 'migrations')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    const applied = new Set((await client.query<{ version: string }>('select version from schema_migrations')).rows.map((r) => r.version))
    let count = 0
    for (const file of files) {
      const version = file.replace(/\.sql$/, '')
      if (applied.has(version)) continue
      log(`applying ${file}`)
      await client.query('begin')
      try {
        await client.query(await readFile(path.join(dir, file), 'utf8'))
        await client.query('insert into schema_migrations (version) values ($1)', [version])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback')
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
      }
      count++
    }
    log(`${count} applied, database up to date`)

    if (opts.appPassword) {
      const { rows } = await client.query<{ sql: string }>("select format('alter role release_tracker_app with login password %L', $1::text) as sql", [opts.appPassword])
      await client.query(rows[0]!.sql)
    }

    if (opts.seed) {
      const done = await client.query("select 1 from seed_runs where name = 'demo'")
      if (done.rowCount) log('demo data already loaded')
      else {
        log('loading demo data')
        const hash = await hashPassword('password123')
        const sql = (await readFile(path.join(sqlDir, 'seed.sql'), 'utf8')).replaceAll('__DEMO_PASSWORD_HASH__', hash)
        await client.query('begin')
        try {
          await client.query(sql)
          await client.query("insert into seed_runs (name) values ('demo')")
          await client.query('commit')
        } catch (err) {
          await client.query('rollback')
          throw new Error(`Seed failed: ${(err as Error).message}`)
        }
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => {})
    await client.end()
  }
}

// CLI entry
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig()
  if (!config.DATABASE_OWNER_URL) throw new Error('DATABASE_OWNER_URL is required to migrate.')
  await migrate(config.DATABASE_OWNER_URL, { appPassword: config.APP_DB_PASSWORD, seed: config.SEED })
}
