// Lot 8: budget lines and overrides through the API (spec 3.6, R3, R4, 4.3), with cases A and
// B of spec 1.4 played the way a person plays them in the app, on a simulated date.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { API_VERSION, API_VERSION_HEADER, SIMULATED_TODAY_HEADER, type BaseResponse } from '../../shared/src/api'
import { assemble, budgetData, decodeData } from '../../shared/src/wire'
import { CAT, LINE, casesABSeedInput, euros, exampleSeedInput, versionId } from '../../shared/fixtures/example'
import { seedSql, toSeed } from '../../shared/fixtures/seed'
import { Ledger } from '../../shared/src/engine'
import { createApp } from '../src/app'
import type { Bindings } from '../src/types'
import { runSql, testDb, type TestDb } from './d1'

const P1 = 'p1@example.test'
const P2 = 'p2@example.test'
const BASE = 'http://localhost:8787'
const MARCH = '2027-03-15'
const MAY = '2027-05-10'
const app = createApp()
let t: TestDb
beforeAll(async () => {
  t = await testDb()
}, 60_000)
afterAll(async () => t?.dispose())

const env = (email = P1): Bindings => ({
  ASSETS: { fetch: async () => new Response('x') } as unknown as Fetcher,
  DB: t.db,
  ENVIRONMENT: 'local',
  ALLOWED_USERS: JSON.stringify({ [P1]: 'Alice', [P2]: 'Bob' }),
  DEV_AUTH_EMAIL: email,
})

const headers = (today: string): Record<string, string> => ({
  [API_VERSION_HEADER]: String(API_VERSION),
  [SIMULATED_TODAY_HEADER]: today,
  Origin: BASE,
  'Content-Type': 'application/json',
})

async function send(method: string, path: string, body: unknown, today: string, who = P1) {
  const res = await app.request(`${BASE}${path}`, { method, headers: headers(today), body: JSON.stringify(body) }, env(who))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
const post = (path: string, body: unknown, today: string, who = P1) => send('POST', path, body, today, who)
const patch = (path: string, body: unknown, today: string, who = P1) => send('PATCH', path, body, today, who)

async function load(today = MARCH) {
  const res = await app.request(`${BASE}/api/data`, { headers: headers(today) }, env())
  const base = (await res.json()) as BaseResponse
  const pages = await Promise.all(
    Array.from({ length: base.operationPages }, async (_, k) => {
      const r = await app.request(`${BASE}/api/data/operations/${k}`, { headers: headers(today) }, env())
      return r.json()
    }),
  )
  return decodeData(assemble(base, pages as never))
}
const ledgerOf = async (today = MARCH) => new Ledger(budgetData(await load(today)) as NonNullable<ReturnType<typeof budgetData>>)
const lineVersion = async (id: number) => (await load()).budgetLines.find((l) => l.id === id)!.rowVersion
const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

async function override(lineId: number, month: string, amount: number, today: string, reason: string | null = null, who = P1) {
  return post(`/api/budget-lines/${lineId}/override`, { rowVersion: await lineVersion(lineId), month, amountCents: euros(amount), reason }, today, who)
}

describe('case A: quarterly line changed during the year (R3, C1)', () => {
  beforeAll(async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
  })

  it('in March, overrides July at 250 € and October at 300 €', async () => {
    expect((await override(LINE.insuranceCar, '2027-07', 250, MARCH)).status).toBe(200)
    expect((await override(LINE.insuranceCar, '2027-10', 300, MARCH)).status).toBe(200)
  })

  it('on 10 May, 270 € every 2 months from June, anchor kept', async () => {
    const out = await patch(
      `/api/budget-lines/${LINE.insuranceCar}`,
      {
        rowVersion: await lineVersion(LINE.insuranceCar),
        change: { fromMonth: '2027-06', categoryId: CAT.insuranceCar, amountCents: euros(270), rhythm: { kind: 'every_n', everyN: 2 } },
      },
      MAY,
    )
    expect(out.status).toBe(200)
    const d = await load(MAY)
    const versions = d.versions.filter((v) => v.budgetLineId === LINE.insuranceCar && v.replacedAt === null)
    expect(versions.map((v) => [v.amountCents, v.rhythm, v.startMonth, v.endMonth])).toEqual([
      [euros(240), { kind: 'every_n', everyN: 3, anchorMonth: '2027-01' }, '2027-01', '2027-05'],
      [euros(270), { kind: 'every_n', everyN: 2, anchorMonth: '2027-01' }, '2027-06', null],
    ])
    const overrides = d.overrides.filter((o) => o.budgetLineId === LINE.insuranceCar)
    expect(overrides.map((o) => [o.month, o.removedAt === null])).toEqual([
      ['2027-07', true],
      ['2027-10', false],
    ])
  })

  it('plans 1,270 € for Assurance > Auto in 2027', async () => {
    const ledger = await ledgerOf(MAY)
    const planned = monthsOf(2027).map((m) => Math.abs(ledger.planned(CAT.insuranceCar, m)) / 100)
    expect(planned).toEqual([240, 0, 0, 240, 0, 0, 250, 0, 270, 0, 270, 0])
  })
})

describe('case B: archived line (R4, off budget)', () => {
  beforeAll(async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(casesABSeedInput(), [P1, P2])))
  })

  it('in March, overrides June at 200 €', async () => {
    expect((await override(LINE.energy, '2027-06', 200, MARCH)).status).toBe(200)
  })

  it('on 10 May, archives Énergie with April as its last month, June override removed', async () => {
    const before = await ledgerOf(MAY)
    expect(before.plannedNet('2027-05')).toBe(euros(2110))
    const out = await post(`/api/budget-lines/${LINE.energy}/archive`, { rowVersion: await lineVersion(LINE.energy), lastMonth: '2027-04' }, MAY)
    expect(out.status).toBe(200)
    const d = await load(MAY)
    expect(d.versions.find((v) => v.id === versionId(LINE.energy))?.endMonth).toBe('2027-04')
    expect(d.overrides.find((o) => o.budgetLineId === LINE.energy && o.month === '2027-06')?.removedAt).not.toBeNull()
    const ledger = await ledgerOf(MAY)
    expect(['2027-04', '2027-05', '2027-06'].map((m) => Math.abs(ledger.planned(CAT.energy, m)) / 100)).toEqual([150, 0, 0])
    expect(ledger.plannedNet('2027-05')).toBe(euros(2260))
    // May, Énergie: off budget, actual -150 €, no remainder.
    expect(ledger.actual(CAT.energy, '2027-05')).toBe(euros(-150))
    expect(ledger.status(CAT.energy, '2027-05')).toBe('off_budget')
    expect(ledger.remaining(CAT.energy, '2027-05')).toBeNull()
  })
})

describe('writes on budget lines', () => {
  beforeEach(async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
  })

  it('creates a line anchored on its first month, with its author', async () => {
    const out = await post(
      '/api/budget-lines',
      { label: 'Cantine', categoryId: CAT.childcare, amountCents: euros(90), startMonth: '2027-04', rhythm: { kind: 'every_n', everyN: 2 } },
      MARCH,
      P2,
    )
    expect(out.status).toBe(200)
    const [lineId] = out.body.ids as number[]
    const d = await load()
    expect(d.budgetLines.find((l) => l.id === lineId)).toMatchObject({ label: 'Cantine', createdBy: 'Bob' })
    expect(d.versions.find((v) => v.budgetLineId === lineId)).toMatchObject({
      categoryId: CAT.childcare,
      amountCents: euros(90),
      startMonth: '2027-04',
      endMonth: null,
      rhythm: { kind: 'every_n', everyN: 2, anchorMonth: '2027-04' },
      createdBy: 'Bob',
    })
  })

  it('refuses a new line that starts before the current month, or with a bad rhythm', async () => {
    const body = { label: 'X', categoryId: CAT.childcare, amountCents: 100, startMonth: '2027-02', rhythm: { kind: 'every_n', everyN: 1 } }
    expect((await post('/api/budget-lines', body, MARCH)).body.error).toBe('from_month_in_past')
    expect((await post('/api/budget-lines', { ...body, startMonth: '2027-03', rhythm: { kind: 'months', months: [] } }, MARCH)).body.error).toBe(
      'invalid_rhythm',
    )
    expect((await post('/api/budget-lines', { ...body, startMonth: '2027-03', amountCents: 0 }, MARCH)).status).toBe(400)
    expect((await post('/api/budget-lines', { ...body, startMonth: '2031-01' }, MARCH)).body.error).toBe('month_too_far')
  })

  it('refuses a line in an archived category', async () => {
    const cat = (await load()).categories.find((c) => c.id === CAT.pharmacy)!
    // A category with no active line can be archived (lot 7); its lines then cannot go there.
    expect((await post(`/api/categories/${CAT.pharmacy}/archive`, { rowVersion: cat.rowVersion }, MARCH)).status).toBe(200)
    const body = { label: 'X', categoryId: CAT.pharmacy, amountCents: 100, startMonth: '2027-03', rhythm: { kind: 'every_n', everyN: 1 } }
    expect((await post('/api/budget-lines', body, MARCH)).body.error).toBe('category_archived')
  })

  it('renames a line without a new version', async () => {
    const out = await patch(`/api/budget-lines/${LINE.cats}`, { rowVersion: await lineVersion(LINE.cats), label: 'Chats et croquettes' }, MARCH)
    expect(out.status).toBe(200)
    const d = await load()
    expect(d.budgetLines.find((l) => l.id === LINE.cats)?.label).toBe('Chats et croquettes')
    expect(d.versions.filter((v) => v.budgetLineId === LINE.cats)).toHaveLength(1)
  })

  it('refuses a change from a past month (R3)', async () => {
    const out = await patch(
      `/api/budget-lines/${LINE.cats}`,
      { rowVersion: await lineVersion(LINE.cats), change: { fromMonth: '2027-02', categoryId: CAT.cats, amountCents: 5000, rhythm: { kind: 'every_n', everyN: 1 } } },
      MARCH,
    )
    expect(out).toEqual({ status: 422, body: { error: 'from_month_in_past' } })
  })

  it('keeps the last month of a line archived later on, when it changes (R3)', async () => {
    await post(`/api/budget-lines/${LINE.cats}/archive`, { rowVersion: await lineVersion(LINE.cats), lastMonth: '2027-08' }, MARCH)
    await patch(
      `/api/budget-lines/${LINE.cats}`,
      { rowVersion: await lineVersion(LINE.cats), change: { fromMonth: '2027-05', categoryId: CAT.cats, amountCents: 5000, rhythm: { kind: 'every_n', everyN: 1 } } },
      MARCH,
    )
    const counted = (await load()).versions.filter((v) => v.budgetLineId === LINE.cats && v.replacedAt === null)
    expect(counted.map((v) => [v.startMonth, v.endMonth, v.amountCents])).toEqual([
      ['2027-03', '2027-04', 4000],
      ['2027-05', '2027-08', 5000],
    ])
  })

  it('archives with the previous month at the earliest (R4)', async () => {
    const out = await post(`/api/budget-lines/${LINE.cats}/archive`, { rowVersion: await lineVersion(LINE.cats), lastMonth: '2027-01' }, MARCH)
    expect(out).toEqual({ status: 422, body: { error: 'last_month_too_early' } })
  })
})

describe('overrides', () => {
  beforeEach(async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
  })

  it('changing an override removes it and creates a new one, both kept', async () => {
    await override(LINE.groceries, '2027-04', 900, MARCH, 'Pâques', P1)
    const out = await override(LINE.groceries, '2027-04', 850, MARCH, null, P2)
    expect(out.status).toBe(200)
    const april = (await load()).overrides.filter((o) => o.budgetLineId === LINE.groceries && o.month === '2027-04')
    expect(april.map((o) => [o.amountCents, o.reason, o.removedAt === null, o.createdBy, o.updatedBy])).toEqual([
      [euros(900), 'Pâques', false, 'Alice', 'Bob'],
      [euros(850), null, true, 'Bob', 'Bob'],
    ])
  })

  it('0 € cancels the line that month; removing marks the override removed', async () => {
    await override(LINE.cats, '2027-04', 0, MARCH)
    expect((await ledgerOf()).lineInMonth(LINE.cats, '2027-04')?.amountCents).toBe(0)
    const out = await post(`/api/budget-lines/${LINE.cats}/override/remove`, { rowVersion: await lineVersion(LINE.cats), month: '2027-04' }, MARCH)
    expect(out.status).toBe(200)
    expect((await ledgerOf()).lineInMonth(LINE.cats, '2027-04')?.amountCents).toBe(euros(40))
    expect((await load()).overrides.find((o) => o.budgetLineId === LINE.cats)?.removedAt).not.toBeNull()
  })

  it('refuses a past month, or a month where the line does not apply', async () => {
    expect((await override(LINE.cats, '2027-02', 10, MARCH)).body.error).toBe('month_in_past')
    expect((await override(LINE.insuranceCar, '2027-05', 10, MARCH)).body.error).toBe('not_applicable')
    const remove = await post(`/api/budget-lines/${LINE.cats}/override/remove`, { rowVersion: await lineVersion(LINE.cats), month: '2027-05' }, MARCH)
    expect(remove.body.error).toBe('no_override')
  })
})

describe('two people at the same time: « Modifié entre-temps »', () => {
  beforeEach(async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
  })

  it('refuses a change made on a line the other person changed meanwhile; nothing is written', async () => {
    const read = await lineVersion(LINE.groceries)
    // Person 2 overrides April first.
    expect((await post(`/api/budget-lines/${LINE.groceries}/override`, { rowVersion: read, month: '2027-04', amountCents: 90000, reason: null }, MARCH, P2)).status).toBe(200)
    // Person 1 still had the version read before.
    const out = await patch(
      `/api/budget-lines/${LINE.groceries}`,
      { rowVersion: read, change: { fromMonth: '2027-04', categoryId: CAT.groceries, amountCents: 85000, rhythm: { kind: 'every_n', everyN: 1 } } },
      MARCH,
      P1,
    )
    expect(out).toEqual({ status: 409, body: { error: 'conflict', changed: [{ table: 'budget_line', id: LINE.groceries }] } })
    expect((await load()).versions.filter((v) => v.budgetLineId === LINE.groceries)).toHaveLength(1)
  })

  it('refuses a second override sent on the same version', async () => {
    const read = await lineVersion(LINE.groceries)
    const body = { rowVersion: read, month: '2027-05', amountCents: 90000, reason: null }
    expect((await post(`/api/budget-lines/${LINE.groceries}/override`, body, MARCH, P1)).status).toBe(200)
    expect((await post(`/api/budget-lines/${LINE.groceries}/override`, body, MARCH, P2)).status).toBe(409)
  })
})
