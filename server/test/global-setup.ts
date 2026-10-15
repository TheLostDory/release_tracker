import pg from 'pg'
import type { TestProject } from 'vitest/node'
import { migrate } from '../db/migrate.js'

/**
 * Creates a fresh test database (dropping the previous one), migrates it and
 * loads the demo seed. Needs TEST_DATABASE_ADMIN_URL: an owner connection to
 * any database on the server, e.g. postgres://postgres:pw@127.0.0.1:54340/postgres
 */
export const TEST_DB = 'release_tracker_test'
export const TEST_APP_PASSWORD = 'test-app-password-123'

declare module 'vitest' {
  export interface ProvidedContext {
    appDatabaseUrl: string
  }
}

export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL
  if (!adminUrl) throw new Error('Set TEST_DATABASE_ADMIN_URL to run the API tests (see README).')
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`drop database if exists ${TEST_DB} with (force)`)
  await admin.query(`create database ${TEST_DB}`)
  await admin.end()

  const ownerUrl = withDatabase(adminUrl, TEST_DB)
  await migrate(ownerUrl, { appPassword: TEST_APP_PASSWORD, seed: true, log: () => {} })
  const app = new URL(ownerUrl)
  app.username = 'release_tracker_app'
  app.password = TEST_APP_PASSWORD
  project.provide('appDatabaseUrl', app.toString())
}

function withDatabase(url: string, db: string) {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}
