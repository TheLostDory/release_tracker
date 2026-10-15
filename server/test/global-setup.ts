import pg from 'pg'
import type { TestProject } from 'vitest/node'
import { migrate } from '../db/migrate.js'

/**
 * Creates a fresh test database (dropping the previous one), migrates it and
 * loads the demo seed. Needs TEST_DATABASE_ADMIN_URL: an owner connection to
 * any database on the server, e.g. postgres://postgres:pw@127.0.0.1:54340/postgres
 */
export const TEST_DB = 'release_tracker_test'

declare module 'vitest' {
  export interface ProvidedContext {
    appDatabaseUrl: string
  }
}

export default async function setup(project: TestProject) {
  // Smoke mode: test an already-running deployment instead (no DB access).
  if (process.env.API_BASE_URL) {
    project.provide('appDatabaseUrl', '')
    return
  }
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
  if (!adminUrl) throw new Error('Set TEST_DATABASE_ADMIN_URL to run the API tests (see README).')
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`drop database if exists ${TEST_DB} with (force)`)
  await admin.query(`create database ${TEST_DB}`)
  await admin.end()

  const ownerUrl = withDatabase(adminUrl, TEST_DB)
  // No appPassword: Postgres logins are server-wide, and changing the app
  // login's password here would break any app running on the same server.
  await migrate(ownerUrl, { seed: true, log: () => {} })
  // Tests act as the restricted app role by switching role at connect time:
  // same RLS and privileges, no shared password involved.
  const app = new URL(ownerUrl)
  app.searchParams.set('options', '-c role=release_tracker_app')
  project.provide('appDatabaseUrl', app.toString())
}

function withDatabase(url: string, db: string) {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}
