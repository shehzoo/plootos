import { Hono } from 'hono'
import type { MeResponse } from '../../shared/src/api'
import { accessAuth, type AccessAuthOptions } from './auth'
import type { AppEnv } from './types'

export function createApp(options: AccessAuthOptions = {}) {
  const app = new Hono<AppEnv>()

  app.use('*', accessAuth(options))

  app.get('/api/me', (c) => {
    const body: MeResponse = { firstName: c.get('user').firstName }
    return c.json(body, 200, { 'Cache-Control': 'no-store' })
  })

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store' }))

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
    return res
  })

  return app
}
