import type { MiddlewareHandler } from 'hono'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { AppEnv, User } from './types'

// Access puts the signed token in this header on every request it lets through.
export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const jwksCache = new Map<string, JWTVerifyGetKey>()
function remoteKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = jwksCache.get(teamDomain)
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain))
    jwksCache.set(teamDomain, keys)
  }
  return keys
}

/** ALLOWED_USERS secret: {"address@example.com": "First name", ...}. */
export function parseAllowedUsers(raw: string | undefined): Map<string, string> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const users = new Map<string, string>()
    for (const [email, firstName] of Object.entries(parsed)) {
      if (typeof firstName !== 'string' || !firstName) return null
      users.set(email.trim().toLowerCase(), firstName)
    }
    return users.size > 0 ? users : null
  } catch {
    return null
  }
}

function refuse(c: Parameters<MiddlewareHandler<AppEnv>>[0], status: 401 | 403 | 500, code: string) {
  // No detail on why: nothing useful for someone who got past Access by mistake.
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: code }, status, { 'Cache-Control': 'no-store' })
  }
  return c.text(status === 500 ? 'Configuration incomplète.' : 'Accès refusé.', status, {
    'Cache-Control': 'no-store',
  })
}

export interface AccessAuthOptions {
  /** Tests only: replaces the remote key set of Access. */
  getKey?: JWTVerifyGetKey
}

/**
 * Checks the Access token on every request (spec 4.7): signature, audience,
 * issuer, expiry, then that the address is one of the allowed ones.
 * The address is read from the verified token only.
 */
export function accessAuth(options: AccessAuthOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const users = parseAllowedUsers(c.env.ALLOWED_USERS)
    if (!users) return refuse(c, 500, 'misconfigured')

    const token = c.req.header(ACCESS_JWT_HEADER)

    if (!token) {
      // Local development only: needs both the variable (.dev.vars, never deployed)
      // and a local host name.
      const devEmail = c.env.DEV_AUTH_EMAIL?.trim().toLowerCase()
      const host = new URL(c.req.url).hostname
      if (devEmail && LOCAL_HOSTS.has(host)) {
        const firstName = users.get(devEmail)
        if (!firstName) return refuse(c, 403, 'forbidden')
        c.set('user', { email: devEmail, firstName } satisfies User)
        return next()
      }
      return refuse(c, 401, 'unauthenticated')
    }

    const teamDomain = c.env.ACCESS_TEAM_DOMAIN
    const audience = c.env.ACCESS_AUD
    if (!teamDomain || !audience) return refuse(c, 500, 'misconfigured')

    let email: string
    try {
      const { payload } = await jwtVerify(token, options.getKey ?? remoteKeys(teamDomain), {
        issuer: teamDomain,
        audience,
        algorithms: ['RS256'],
      })
      if (typeof payload.email !== 'string' || !payload.email) {
        return refuse(c, 403, 'forbidden')
      }
      email = payload.email.trim().toLowerCase()
    } catch {
      return refuse(c, 401, 'unauthenticated')
    }

    const firstName = users.get(email)
    if (!firstName) return refuse(c, 403, 'forbidden')

    c.set('user', { email, firstName } satisfies User)
    return next()
  }
}
