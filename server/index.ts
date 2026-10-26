import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { startJenkinsPoller } from './integrations/poller.js'
import { startNotifier } from './notifications/notifier.js'
import { startAutomationWorker } from './automation/worker.js'
import { ReleaseEvents } from './realtime.js'

const config = loadConfig()
const db = createPool(config.DATABASE_URL)
const events = new ReleaseEvents(config.DATABASE_URL)
await events.start()

const app = createApp({ db, config, events })
const server = app.listen(config.PORT, () => console.log(`[api] listening on :${config.PORT}`))

// Jenkins: refresh linked jobs of undeployed releases every 2 minutes.
const stopPoller = startJenkinsPoller(db, config)

// Teams: deliver queued notifications and daily summaries.
const stopNotifier = startNotifier(db, config)

// Automation: start requested Jenkins jobs and follow their runs.
const stopAutomation = startAutomationWorker(db, config)

// Housekeeping: drop expired sessions hourly.
const sweep = setInterval(() => void db.query('select delete_expired_sessions()').catch(() => {}), 3600_000)

async function shutdown(signal: string) {
  console.log(`[api] ${signal}, shutting down`)
  clearInterval(sweep)
  stopPoller()
  stopNotifier()
  stopAutomation()
  server.close()
  await events.stop()
  await db.end()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
