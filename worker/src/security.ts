// Headers of every response, and checks of every API request (spec 4.7, 4.8).

import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { API_VERSION, API_VERSION_HEADER, type ApiError } from '../../shared/src/api'
import type { AppEnv } from './types'

/**
 * Strict content security policy: the app's own files only, no inline script or style, no
 * data: URL (Vite inlines nothing, see vite.config.ts), no framing, nothing from elsewhere.
 * A bank label or a comment can never run as code.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  const h = c.res.headers
  h.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  h.set('X-Content-Type-Options', 'nosniff')
  h.set('Referrer-Policy', 'no-referrer')
  h.set('X-Frame-Options', 'DENY')
  h.set('Cross-Origin-Opener-Policy', 'same-origin')
  h.set('Cross-Origin-Resource-Policy', 'same-origin')
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  // Server answers are never kept in a cache (spec 4.5).
  if (c.req.path.startsWith('/api/')) h.set('Cache-Control', 'no-store')
}

export const refuse = (c: Parameters<MiddlewareHandler<AppEnv>>[0], status: 400 | 403 | 409 | 413 | 415, body: ApiError) =>
  c.json(body, status)

/** An app on another compatibility number is refused, and reloads (spec 4.8). */
export const apiVersionCheck: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header(API_VERSION_HEADER) !== String(API_VERSION)) {
    return refuse(c, 409, { error: 'app_outdated' })
  }
  return next()
}

const READS = new Set(['GET', 'HEAD'])
/** Writes are small JSON requests; a larger body is refused before it is read. */
export const MAX_WRITE_BYTES = 1024 * 1024

/**
 * Writes only from the app itself (spec 4.7): same origin, JSON body. The version header,
 * already required, cannot be sent by a form of another site either.
 */
export const writeChecks: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (READS.has(c.req.method)) return next()
  if (c.req.header('Origin') !== new URL(c.req.url).origin) {
    return refuse(c, 403, { error: 'forbidden', reason: 'origin' })
  }
  if (!(c.req.header('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
    return refuse(c, 415, { error: 'unsupported_media_type' })
  }
  return bodyLimit({
    maxSize: MAX_WRITE_BYTES,
    onError: (c) => refuse(c, 413, { error: 'payload_too_large' }),
  })(c, next)
}
