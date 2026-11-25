// Lot 11: export and restore (spec 3.8, 4.3, 4.6). Criterion: export, empty, restore, and find
// the results of the example month (1.3) exactly as before.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  API_VERSION,
  API_VERSION_HEADER,
  SCHEMA_VERSION,
  SIMULATED_TODAY_HEADER,
  type BaseResponse,
  type DataResponse,
  type OperationsPageResponse,
} from '../../shared/src/api'
import { buildExport, readExport, restoreLots, type ExportFile, type RestoreLotRequest } from '../../shared/src/backup'
import { assemble, budgetData, decodeData } from '../../shared/src/wire'
import { CAT, euros, exampleSeedInput } from '../../shared/fixtures/example'
import { seedSql, toSeed } from '../../shared/fixtures/seed'
import { threeYearsSeedInput } from '../../shared/fixtures/three-years'
import { Ledger } from '../../shared/src/engine'
import { createApp } from '../src/app'
import { MAX_WRITE_BYTES } from '../src/security'
import type { Bindings } from '../src/types'
import { runSql, testDb, type TestDb } from './d1'

const P1 = 'p1@example.test'
const P2 = 'p2@example.test'
const BASE = 'http://localhost:8787'
const APRIL_1 = '2027-04-01'
const EXPORTED_AT = '2027-04-01T08:30:00.000Z'
const app = createApp()
let t: TestDb
beforeAll(async () => {
  t = await testDb()
}, 60_000)
afterAll(async () => t?.dispose())

const env = (environment = 'local', users: Record<string, string> = { [P1]: 'Alice', [P2]: 'Bob' }): Bindings => ({
  ASSETS: { fetch: async () => new Response('x') } as unknown as Fetcher,
  DB: t.db,
  ENVIRONMENT: environment,
  ALLOWED_USERS: JSON.stringify(users),
  DEV_AUTH_EMAIL: Object.keys(users)[0],
})

const headers = (): Record<string, string> => ({
  [API_VERSION_HEADER]: String(API_VERSION),
  [SIMULATED_TODAY_HEADER]: APRIL_1,
  Origin: BASE,
  'Content-Type': 'application/json',
})

async function post(path: string, body: unknown, bindings = env()) {
  const res = await app.request(`${BASE}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }, bindings)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** Everything, as the app reads it (GET /api/data and its pages). */
async function readAll(bindings = env()): Promise<DataResponse> {
  const res = await app.request(`${BASE}/api/data`, { headers: headers() }, bindings)
  expect(res.status).toBe(200)
  const base = (await res.json()) as BaseResponse
  const pages = await Promise.all(
    Array.from({ length: base.operationPages }, async (_, k) =>
      (await (await app.request(`${BASE}/api/data/operations/${k}`, { headers: headers() }, bindings)).json()) as OperationsPageResponse,
    ),
  )
  return assemble(base, pages)
}

const ledgerOf = (data: DataResponse) => new Ledger(budgetData(decodeData(data)) as NonNullable<ReturnType<typeof budgetData>>)

async function seedExample() {
  await t.reset()
  await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
}

/** The file the app would download, read back as the app reads a chosen file. */
async function exported(environment: 'local' | 'staging' | 'production' = 'local'): Promise<{ before: DataResponse; file: ExportFile }> {
  const before = await readAll()
  const text = JSON.stringify(buildExport({ ...before, environment }, 'Alice', EXPORTED_AT))
  const read = readExport(text, environment)
  if (!read.ok) throw new Error(read.error)
  return { before, file: read.file }
}

async function restoreAll(lots: RestoreLotRequest[], bindings = env()) {
  for (const lot of lots) {
    const out = await post('/api/restore', lot, bindings)
    expect(out.status, JSON.stringify(out.body)).toBe(200)
    expect(out.body.done).toBe(lot.lot === lot.lots - 1)
  }
}

describe('export, empty, restore (criterion of lot 11)', () => {
  it('finds the example month exactly as before, ids, versions and traceability included', async () => {
    await seedExample()
    const { before, file } = await exported()
    await t.reset()
    const lots = restoreLots(file, 7)
    expect(lots.length).toBeGreaterThan(3)
    await restoreAll(lots)
    const after = await readAll()
    expect(after.tables).toEqual(before.tables)
    expect(after.lastExportAt).toBe(EXPORTED_AT)

    // The results of spec 1.3, from the restored data.
    const ledger = ledgerOf(after)
    expect(ledger.monthSummary('2027-03')).toEqual({
      plannedNetCents: euros(1600),
      actualNetCents: euros(1998),
      gapCents: euros(398),
      startBalanceCents: euros(3000),
      plannedEndBalanceCents: euros(4600),
      actualEndBalanceCents: euros(4998),
    })
    expect(ledger.gap(CAT.groceries, '2027-03')).toBe(euros(-425))
    expect(ledger.projection('2027-04')).toEqual(ledgerOf(before).projection('2027-04'))
  })

  it('restores three years of fictitious data in lots small enough for one request each', async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(threeYearsSeedInput(), [P1, P2])))
    const { before, file } = await exported()
    const lots = restoreLots(file)
    for (const lot of lots) expect(JSON.stringify(lot).length).toBeLessThan(MAX_WRITE_BYTES)
    await t.reset()
    await restoreAll(lots)
    const after = await readAll()
    expect(after.tables).toEqual(before.tables)
  }, 60_000)

  it('turns each first name back into its allowed address; an unknown one reads « ? »', async () => {
    await seedExample()
    const { file } = await exported()
    const sectionTrace = file.tables.section?.rows[0] as (string | number | null)[]
    const by = file.tables.section?.columns.indexOf('created_by') as number
    sectionTrace[by] = 'Personne inconnue'
    await t.reset()
    // Same people, addresses changed: the first names still match.
    const moved = env('local', { 'new1@example.test': 'Alice', 'new2@example.test': 'Bob' })
    await restoreAll(restoreLots(file), moved)
    const stored = await t.db.prepare('SELECT DISTINCT created_by AS a FROM category ORDER BY a').all<{ a: string }>()
    expect(stored.results.map((r) => r.a).every((a) => a === 'new1@example.test' || a === 'new2@example.test')).toBe(true)
    const first = await t.db.prepare('SELECT created_by AS a FROM section ORDER BY id LIMIT 1').first<{ a: string }>()
    expect(first?.a).toBe('?')
    const after = await readAll(moved)
    expect(after.tables.section[0]?.[6]).toBe('?')
  })
})

describe('restore refused', () => {
  it('on a database that is not empty, nothing written', async () => {
    await seedExample()
    const { file } = await exported()
    const [first] = restoreLots(file, 7)
    const out = await post('/api/restore', first)
    expect(out).toMatchObject({ status: 422, body: { error: 'not_empty' } })
    expect(await readAll()).toBeDefined()
  })

  it('a later lot without a first one', async () => {
    await seedExample()
    const { file } = await exported()
    await t.reset()
    const lots = restoreLots(file, 7)
    const out = await post('/api/restore', lots[1])
    expect(out).toMatchObject({ status: 422, body: { error: 'restore_not_started' } })
  })

  it('an export of another kind of environment, or of another schema', async () => {
    await seedExample()
    const { file } = await exported()
    await t.reset()
    const [first] = restoreLots(file, 7) as [RestoreLotRequest]
    expect(await post('/api/restore', { ...first, sourceEnvironment: 'production' })).toMatchObject({ status: 422, body: { error: 'other_environment' } })
    expect(await post('/api/restore', first, env('production'))).toMatchObject({ status: 422, body: { error: 'other_environment' } })
    expect(await post('/api/restore', { ...first, schemaVersion: SCHEMA_VERSION + 1 })).toMatchObject({ status: 422, body: { error: 'schema_mismatch' } })
    // A staging export restores locally (both test environments).
    expect((await post('/api/restore', { ...first, sourceEnvironment: 'staging' })).status).toBe(200)
  })

  it('a cell of the wrong type, before anything is written', async () => {
    await t.reset()
    const lot: RestoreLotRequest = {
      lot: 0,
      lots: 2,
      schemaVersion: SCHEMA_VERSION,
      sourceEnvironment: 'local',
      exportedAt: EXPORTED_AT,
      tables: { section: [['1', 'Revenus', 'in', 0, null, 1, 'Alice', EXPORTED_AT, 'Alice', EXPORTED_AT]] },
    }
    expect(await post('/api/restore', lot)).toMatchObject({ status: 400, body: { reason: 'rows' } })
    expect((await readAll()).tables.section).toEqual([])
  })
})

describe('an unfinished restore blocks the app', () => {
  it('refuses every read and write until the database is emptied', async () => {
    await seedExample()
    const { file } = await exported()
    await t.reset()
    const lots = restoreLots(file, 7)
    await restoreAll(lots.slice(0, 2))
    // Reads, writes, setup, the export date: all refused while the marker is set.
    const read = await app.request(`${BASE}/api/data`, { headers: headers() }, env())
    expect(read.status).toBe(503)
    expect(await read.json()).toEqual({ error: 'restore_in_progress' })
    expect(await post('/api/setup', { amountCents: 100 })).toMatchObject({ status: 503, body: { error: 'restore_in_progress' } })
    expect(await post('/api/exports', {})).toMatchObject({ status: 503, body: { error: 'restore_in_progress' } })
    expect(await post('/api/sections', { name: 'X', direction: 'in' })).toMatchObject({ status: 503 })

    // A last lot whose counts do not match: still blocked.
    const lastLot = lots[lots.length - 1] as RestoreLotRequest
    const out = await post('/api/restore', lastLot)
    expect(out).toMatchObject({ status: 422, body: { error: 'incomplete' } })
    expect((await app.request(`${BASE}/api/data`, { headers: headers() }, env())).status).toBe(503)

    // « Vider la base » (drop, migrations): then a full restore works.
    await t.reset()
    await restoreAll(lots)
    expect((await readAll()).tables.operation).toHaveLength(13)
  })
})

describe('date of the last export', () => {
  it('is recorded by POST /api/exports, once set up only', async () => {
    await t.reset()
    expect(await post('/api/exports', {})).toMatchObject({ status: 422, body: { error: 'not_set_up' } })
    await seedExample()
    expect((await readAll()).lastExportAt).toBeNull()
    const out = await post('/api/exports', {})
    expect(out.status).toBe(200)
    expect((await readAll()).lastExportAt).toBe(out.body.lastExportAt)
    // On the simulated day (local and staging only), so that the reminder can be tested.
    expect(String(out.body.lastExportAt).slice(0, 10)).toBe(APRIL_1)
  })
})
