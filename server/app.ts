import path from 'node:path'
import compression from 'compression'
import express, { type Express } from 'express'
import type { Config } from './config.js'
import type { Db } from './db/pool.js'
import { authenticate, requireUser } from './auth/sessions.js'
import { errorHandler, notFound } from './http/errors.js'
import { csrfGuard, securityHeaders } from './http/security.js'
import type { ReleaseEvents } from './realtime.js'
import { authRoutes } from './routes/auth.js'
import { chatRoutes } from './routes/chat.js'
import { codeCompareRoutes } from './routes/code-compare.js'
import { integrationRoutes } from './routes/integrations.js'
import { projectRoutes } from './routes/projects.js'
import { releaseRoutes } from './routes/releases.js'

export function createApp({ db, config, events }: { db: Db; config: Config; events: ReleaseEvents }): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.TRUST_PROXY)
  app.use(securityHeaders)
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/events') && compression.filter(req, res) }))

  const api = express.Router()
  api.use(express.json({ limit: '100kb' }))
  api.use(csrfGuard)
  api.use(authenticate(db, config))
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  api.get('/health', (_req, res) => void res.json({ ok: true }))
  api.use('/auth', authRoutes(db, config))
  api.use(requireUser)
  api.use(projectRoutes(db))
  api.use(releaseRoutes(db))
  api.use(integrationRoutes(db, config))
  api.use(chatRoutes(db, config))
  api.use(codeCompareRoutes(db, config))
  api.use(events.routes(db))
  api.use((_req, _res, next) => next(notFound('No such API endpoint.')))
  app.use('/api', api)

  // Production: serve the built SPA (index.html for client-side routes).
  if (config.STATIC_DIR) {
    const dir = path.resolve(config.STATIC_DIR)
    app.use(
      express.static(dir, {
        index: false,
        setHeaders(res, file) {
          const immutable = file.includes(`${path.sep}assets${path.sep}`)
          res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
        },
      }),
    )
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(dir, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
