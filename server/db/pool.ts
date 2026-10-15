import pg from 'pg'

// DATE columns stay "YYYY-MM-DD" strings (calendar days, no timezone), like the
// frontend expects; never JS Dates shifted by the server's timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

export type Db = pg.Pool
export type Tx = pg.PoolClient

export function createPool(connectionString: string, max = 10): Db {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000 })
  pool.on('error', (err) => console.error('[db] idle client error', err.message))
  return pool
}

/**
 * Runs `fn` in a transaction as `userId`: row level security and the
 * activity log see this user (app.user_id is transaction-local).
 */
export async function withUser<T>(db: Db, userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('begin')
    await client.query("select set_config('app.user_id', $1, true)", [userId ?? ''])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
