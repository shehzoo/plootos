// GET /api/data and the checks of every API request, on a local D1 database.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { API_VERSION, API_VERSION_HEADER, SIMULATED_TODAY_HEADER, type DataResponse } from '../../shared/src/api'
import { Ledger } from '../../shared/src/engine'
import { budgetData, decodeData } from '../../shared/src/wire'
import { euros, exampleSeedInput } from '../../shared/fixtures/example'
import { seedResponse, seedSql, toSeed } from '../../shared/fixtures/seed'
import { threeYearsSeedInput } from '../../shared/fixtures/three-years'
import { createApp } from '../src/app'
import { CHUNK_ROWS, selectSql } from '../src/read'
import { CONTENT_SECURITY_POLICY } from '../src/security'
import type { Bindings } from '../src/types'
import { runSql, testDb, type TestDb } from './d1'

// Fictitious addresses and first names only.
const P1 = 'p1@example.test'
const P2 = 'p2@example.test'
const AUTHORS = [P1, P2] as const
const USERS = { [P1]: 'Alice', [P2]: 'Bob' }
const BASE = 'http://localhost:8787'

let t: TestDb
const app = createApp()
beforeAll(async () => {
  t = await testDb()
}, 60_000)
afterAll(async () => t?.dispose())

function env(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ASSETS: {
      fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
    } as unknown as Fetcher,
    DB: t.db,
    ENVIRONMENT: 'local',
    ALLOWED_USERS: JSON.stringify(USERS),
    DEV_AUTH_EMAIL: P1,
    ...overrides,
  }
}

const apiHeaders = { [API_VERSION_HEADER]: String(API_VERSION) }
const get = (path: string, headers: Record<string, string> = apiHeaders, e = env()) =>
  app.request(`${BASE}${path}`, { headers }, e)
const data = async (headers: Record<string, string> = apiHeaders, e = env()) => {
  const res = await get('/api/data', headers, e)
  expect(res.status).toBe(200)
  const text = await res.text()
  return { res, text, body: JSON.parse(text) as DataResponse }
}

describe('GET /api/data, example month (spec 1.3)', () => {
  beforeAll(async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(exampleSeedInput(), AUTHORS)))
  })

  it('answers what the rows hold, authors as first names', async () => {
    const { body } = await data()
    const expected = seedResponse(toSeed(exampleSeedInput(), AUTHORS), new Map(Object.entries(USERS)), body.today)
    expect(body.tables).toEqual(expected.tables)
    expect(body.schemaVersion).toBe(1)
    expect(body.apiVersion).toBe(API_VERSION)
    expect(body.environment).toBe('local')
  })

  it('never sends an address', async () => {
    const { text } = await data()
    expect(text).not.toContain('@')
  })

  it('reads "?" for an author no longer allowed', async () => {
    const { body } = await data(apiHeaders, env({ ALLOWED_USERS: JSON.stringify({ [P1]: 'Alice' }) }))
    const app = decodeData(body)
    const op2 = app.operations.find((o) => o.id === 2)
    expect(op2?.createdBy).toBe('Alice')
    expect(op2?.updatedBy).toBe('?')
  })

  it('gives back the results of spec 1.3 once decoded', async () => {
    const { body } = await data()
    const decoded = decodeData(body)
    expect(decoded.operations.find((o) => o.id === 2)?.updatedBy).toBe('Bob')
    expect(decoded.balanceChecks).toHaveLength(1)
    const ledger = new Ledger(budgetData(decoded)!)
    expect(ledger.monthSummary('2027-03')).toEqual({
      plannedNetCents: euros(1600),
      actualNetCents: euros(1998),
      gapCents: euros(398),
      startBalanceCents: euros(3000),
      plannedEndBalanceCents: euros(4600),
      actualEndBalanceCents: euros(4998),
    })
    const [april, may] = ledger.projection('2027-04')
    expect(april?.endBalanceCents).toBe(euros(6868))
    expect(may?.endBalanceCents).toBe(euros(8978))
  })

  it('is never cached, and carries the security headers', async () => {
    const { res } = await data()
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('is refused while a restore runs (spec 4.3)', async () => {
    await t.db.prepare('UPDATE meta SET restore_in_progress = 1').run()
    const res = await get('/api/data')
    await t.db.prepare('UPDATE meta SET restore_in_progress = 0').run()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'restore_in_progress' })
  })
})

describe('GET /api/data, empty database', () => {
  beforeAll(async () => t.reset())

  it('reads, without an opening balance: the app is not set up yet', async () => {
    const { body } = await data()
    const decoded = decodeData(body)
    expect(decoded.openingBalance).toBeNull()
    expect(budgetData(decoded)).toBeNull()
    expect(decoded.operations).toEqual([])
  })
})

describe('simulated "today" (local and staging only)', () => {
  const simulated = { ...apiHeaders, [SIMULATED_TODAY_HEADER]: '2027-03-15' }

  it('is used in local development and in staging', async () => {
    for (const ENVIRONMENT of ['local', 'staging']) {
      const { body } = await data(simulated, env({ ENVIRONMENT }))
      expect(body.today).toBe('2027-03-15')
      expect(body.todaySimulated).toBe(true)
    }
  })

  it('is ignored in production, and when the variable is missing or unknown', async () => {
    for (const ENVIRONMENT of ['production', undefined, 'Staging', 'prod']) {
      const { body } = await data(simulated, env({ ENVIRONMENT }))
      expect(body.todaySimulated).toBe(false)
      expect(body.today).not.toBe('2027-03-15')
      expect(body.environment).toBe('production')
    }
  })

  it('is ignored when it is not a date', async () => {
    const { body } = await data({ ...apiHeaders, [SIMULATED_TODAY_HEADER]: '2027-02-30' })
    expect(body.todaySimulated).toBe(false)
  })
})

describe('compatibility of the app (spec 4.8)', () => {
  it('refuses an app without the version, or with another one', async () => {
    const variants: Record<string, string>[] = [{}, { [API_VERSION_HEADER]: String(API_VERSION - 1) }, { [API_VERSION_HEADER]: 'x' }]
    for (const headers of variants) {
      const res = await get('/api/me', headers)
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'app_outdated' })
    }
  })

  it('answers an app with the right version', async () => {
    const res = await get('/api/me')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ firstName: 'Alice' })
  })
})

describe('writes only from the app itself (spec 4.7)', () => {
  const post = (headers: Record<string, string>, body = '{}') =>
    app.request(`${BASE}/api/anything`, { method: 'POST', headers: { ...apiHeaders, ...headers }, body }, env())

  it('refuses another origin, or none', async () => {
    for (const Origin of ['https://evil.example', 'http://localhost:9999']) {
      const res = await post({ Origin, 'Content-Type': 'application/json' })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden', reason: 'origin' })
    }
    expect((await post({ 'Content-Type': 'application/json' })).status).toBe(403)
  })

  it('refuses a body that is not JSON (a form of another site)', async () => {
    const res = await post({ Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' }, 'a=1')
    expect(res.status).toBe(415)
  })

  it('refuses a body over 1 MB', async () => {
    const res = await post({ Origin: BASE, 'Content-Type': 'application/json' }, JSON.stringify({ x: 'a'.repeat(1_100_000) }))
    expect(res.status).toBe(413)
  })

  it('lets a well-formed write through to its route', async () => {
    const res = await post({ Origin: BASE, 'Content-Type': 'application/json' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('still requires the version on a write', async () => {
    const res = await app.request(
      `${BASE}/api/anything`,
      { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: '{}' },
      env(),
    )
    expect(res.status).toBe(409)
  })
})

describe('security headers', () => {
  it('are on the pages too, refusals included', async () => {
    const page = await app.request(`${BASE}/`, {}, env())
    expect(page.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(page.headers.get('X-Frame-Options')).toBe('DENY')
    const refused = await app.request('https://budget.example.test/', {}, env())
    expect(refused.status).toBe(401)
    expect(refused.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
  })

  it('allow no inline script, no other site, no framing', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe')
    expect(CONTENT_SECURITY_POLICY).not.toContain('data:')
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
  })
})

describe('three and ten years of fictitious data (lot 3 criterion)', () => {
  it('reads three years', async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(threeYearsSeedInput(), AUTHORS)))
    const { text, body } = await data()
    const size = new TextEncoder().encode(text).length
    const decoded = decodeData(body)
    expect(decoded.operations.length).toBeGreaterThan(5500)
    expect(budgetData(decoded)).not.toBeNull()
    console.info(`3 ans : ${decoded.operations.length} opérations, ${decoded.parts.length} parts, ${(size / 1e6).toFixed(2)} Mo`)
  }, 60_000)

  it('reads ten years', async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(threeYearsSeedInput({ months: 120 }), AUTHORS)))
    const { body } = await data()
    expect(decodeData(body).operations.length).toBeGreaterThan(18000)
  }, 120_000)

  it('keeps each chunk below D1\'s 2 MB per string, even with the longest, worst-escaped texts', async () => {
    await t.reset()
    // Every text at its maximum length, made of characters JSON writes with 6 bytes each.
    const worst = "replace(hex(zeroblob(500)), '00', char(1))"
    await t.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${CHUNK_ROWS * 2})
         INSERT INTO operation (id, op_date, value_date, amount_cents, origin, bank_label, bank_label_raw, dup_rank, comment,
           created_by, created_at, updated_by, updated_at)
         SELECT i, '2027-03-01', '2027-03-01', -i, 'import', ${worst}, ${worst}, i, ${worst}, ?1, ?2, ?1, ?2 FROM n`,
      )
      .bind(P1, '2027-03-01T00:00:00.000Z')
      .run()
    const chunks = await t.db.prepare(selectSql('operation')).bind(JSON.stringify(USERS)).all<{ chunk: string }>()
    expect(chunks.results).toHaveLength(2)
    for (const { chunk } of chunks.results) {
      const bytes = new TextEncoder().encode(chunk).length
      expect(bytes).toBeGreaterThan(1_500_000)
      expect(bytes).toBeLessThan(2_000_000)
    }
    const { body } = await data()
    expect(body.tables.operation).toHaveLength(CHUNK_ROWS * 2)
  }, 60_000)
})
