import { Hono } from 'hono'
import type { ApiError, MeResponse } from '../../shared/src/api'
import { catalog } from './catalog'
import { imports } from './imports'
import { lines } from './lines'
import { operations } from './operations'
import { accessAuth, type AccessAuthOptions } from './auth'
import { readBase, readOperationsPage, RestoreInProgressError } from './read'
import { apiVersionCheck, securityHeaders, writeChecks } from './security'
import { serverToday } from './today'
import type { AppEnv } from './types'

export function createApp(options: AccessAuthOptions = {}) {
  const app = new Hono<AppEnv>()

  app.use('*', securityHeaders)
  app.use('*', accessAuth(options))
  app.use('/api/*', apiVersionCheck)
  app.use('/api/*', writeChecks)

  app.get('/api/me', (c) => {
    const body: MeResponse = { firstName: c.get('user').firstName }
    return c.json(body)
  })

  const json = (body: string) => ({ body, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

  app.get('/api/data', async (c) => {
    const { body, headers } = json(await readBase(c.env, c.get('users'), serverToday(c)))
    return c.body(body, 200, headers)
  })

  app.get('/api/data/operations/:page', async (c) => {
    const raw = c.req.param('page')
    const page = Number(raw)
    if (!/^\d{1,6}$/.test(raw) || !Number.isSafeInteger(page)) {
      return c.json({ error: 'bad_request', reason: 'page' } satisfies ApiError, 400)
    }
    const { body, headers } = json(await readOperationsPage(c.env, c.get('users'), page))
    return c.body(body, 200, headers)
  })

  app.route('/', catalog)
  app.route('/', lines)
  app.route('/', operations)
  app.route('/', imports)

  app.all('/api/*', (c) => c.json({ error: 'not_found' } satisfies ApiError, 404))

  // Static files of the app, served only once the token is checked.
  app.all('*', async (c) => {
    const res = await c.env.ASSETS.fetch(c.req.raw)
    const type = res.headers.get('Content-Type') ?? ''
    if (type.startsWith('text/html') || c.req.path.endsWith('.webmanifest')) {
      // The home page is never cached, so a new version is picked up at once (spec 4.8).
      const fresh = new Response(res.body, res)
      fresh.headers.set('Cache-Control', 'no-cache')
      return fresh
    }
    return new Response(res.body, res)
  })

  // Logs hold fixed codes only: never an amount, a label or the content of a request (spec 4.8).
  app.onError((e, c) => {
    // While a restore runs, no read nor write (spec 4.3).
    if (e instanceof RestoreInProgressError) return c.json({ error: 'restore_in_progress' } satisfies ApiError, 503)
    console.error(JSON.stringify({ event: 'error', method: c.req.method, route: c.req.routePath, kind: e?.constructor?.name }))
    const body: ApiError = { error: 'server_error' }
    return c.json(body, 500)
  })

  return app
}
