import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type CryptoKey } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { ACCESS_JWT_HEADER, parseAllowedUsers } from '../src/auth'
import type { Bindings } from '../src/types'

// Fictitious values only.
const TEAM = 'https://example-team.cloudflareaccess.com'
const AUD = 'test-audience-tag'
const USERS = JSON.stringify({ 'alice@example.test': 'Alice', 'Bob@Example.test': 'Bob' })

let privateKey: CryptoKey
let otherKey: CryptoKey
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }
  app = createApp({ getKey: createLocalJWKSet({ keys: [jwk] }) })
})

function env(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ASSETS: {
      fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
    } as unknown as Fetcher,
    DB: {} as D1Database,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ALLOWED_USERS: USERS,
    ...overrides,
  }
}

interface TokenOptions {
  email?: string | null
  aud?: string
  iss?: string
  exp?: string | number
  key?: CryptoKey
}

async function token(o: TokenOptions = {}) {
  const claims = o.email === null ? {} : { email: o.email ?? 'alice@example.test' }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(o.iss ?? TEAM)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '1h')
    .sign(o.key ?? privateKey)
}

async function me(headers: Record<string, string>, e = env(), url = 'https://budget.example.test/api/me') {
  return app.request(url, { headers }, e)
}

describe('Access token check (spec 4.7)', () => {
  it('returns the first name for a valid token', async () => {
    const res = await me({ [ACCESS_JWT_HEADER]: await token() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ firstName: 'Alice' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('matches the address without regard to case', async () => {
    const res = await me({ [ACCESS_JWT_HEADER]: await token({ email: 'BOB@example.TEST' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ firstName: 'Bob' })
  })

  it('refuses another address', async () => {
    const res = await me({ [ACCESS_JWT_HEADER]: await token({ email: 'eve@example.test' }) })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden', reason: 'email_not_allowed' })
  })

  it('refuses a token without an address', async () => {
    const res = await me({ [ACCESS_JWT_HEADER]: await token({ email: null }) })
    expect(res.status).toBe(403)
  })

  it('refuses a request without a token', async () => {
    const res = await me({})
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated', reason: 'no_token' })
  })

  it('refuses a wrong audience', async () => {
    const res = await me({ [ACCESS_JWT_HEADER]: await token({ aud: 'other-app' }) })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { reason: string }).reason).toMatch(/^claim_aud/)
  })

  it('refuses a wrong issuer', async () => {
    const iss = 'https://other-team.cloudflareaccess.com'
    const res = await me({ [ACCESS_JWT_HEADER]: await token({ iss }) })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated', reason: 'claim_iss' })
  })

  it('refuses an expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 60
    const res = await me({ [ACCESS_JWT_HEADER]: await token({ exp }) })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated', reason: 'err_jwt_expired' })
  })

  it('refuses a token signed with another key', async () => {
    const res = await me({ [ACCESS_JWT_HEADER]: await token({ key: otherKey }) })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated', reason: 'err_jws_signature_verification_failed' })
  })

  it('refuses a malformed token', async () => {
    expect((await me({ [ACCESS_JWT_HEADER]: 'not-a-token' })).status).toBe(401)
  })

  it('ignores an address given anywhere but in the verified token', async () => {
    const res = await me({ 'cf-access-authenticated-user-email': 'alice@example.test' })
    expect(res.status).toBe(401)
  })

  it('protects the static files too', async () => {
    const res = await app.request('https://budget.example.test/', {}, env())
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Accès refusé.')
  })

  it('serves the home page with a valid token, never cached', async () => {
    const res = await app.request(
      'https://budget.example.test/operations',
      { headers: { [ACCESS_JWT_HEADER]: await token() } },
      env(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
  })

  it('fails closed when the Access settings are missing', async () => {
    const t = await token()
    expect((await me({ [ACCESS_JWT_HEADER]: t }, env({ ACCESS_AUD: undefined }))).status).toBe(500)
    expect((await me({ [ACCESS_JWT_HEADER]: t }, env({ ACCESS_TEAM_DOMAIN: '' }))).status).toBe(500)
    expect((await me({ [ACCESS_JWT_HEADER]: t }, env({ ALLOWED_USERS: undefined }))).status).toBe(500)
    expect((await me({ [ACCESS_JWT_HEADER]: t }, env({ ALLOWED_USERS: '{bad json' }))).status).toBe(500)
  })
})

describe('Local development without Access', () => {
  const dev = env({ DEV_AUTH_EMAIL: 'alice@example.test' })

  it('works on localhost with the local variable', async () => {
    const res = await me({}, dev, 'http://localhost:8787/api/me')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ firstName: 'Alice' })
  })

  it('never works on another host, even with the variable', async () => {
    expect((await me({}, dev, 'https://budget.example.test/api/me')).status).toBe(401)
  })

  it('still needs an allowed address', async () => {
    const res = await me({}, env({ DEV_AUTH_EMAIL: 'eve@example.test' }), 'http://127.0.0.1:8787/api/me')
    expect(res.status).toBe(403)
  })
})

describe('parseAllowedUsers', () => {
  it('rejects empty or malformed settings', () => {
    expect(parseAllowedUsers(undefined)).toBeNull()
    expect(parseAllowedUsers('{}')).toBeNull()
    expect(parseAllowedUsers('[]')).toBeNull()
    expect(parseAllowedUsers('{"a@b.c": 3}')).toBeNull()
    expect(parseAllowedUsers('{"a@b.c": ""}')).toBeNull()
  })
})

describe('Unknown API routes', () => {
  it('answer 404 in JSON', async () => {
    const res = await app.request(
      'https://budget.example.test/api/nothing',
      { headers: { [ACCESS_JWT_HEADER]: await token() } },
      env(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('never echoes a token value in the reason', async () => {
    const res = await me({ [ACCESS_JWT_HEADER]: 'not-a-token' })
    const body = (await res.json()) as { reason: string }
    expect(body.reason).toMatch(/^[a-z_]+$/)
  })
})
