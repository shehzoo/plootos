// Lot 9: manual entry, the record of an operation, categorizing (spec 3.2, 3.3, R2, R5, R6, 4.3).
// The operations of the example month (spec 1.3) are entered and categorized by hand, through
// the API, on an empty month: the results of 1.3 come out.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { API_VERSION, API_VERSION_HEADER, SIMULATED_TODAY_HEADER, type BaseResponse } from '../../shared/src/api'
import { assemble, budgetData, decodeData } from '../../shared/src/wire'
import { CAT, euros, exampleSeedInput } from '../../shared/fixtures/example'
import { seedSql, toSeed } from '../../shared/fixtures/seed'
import { Ledger } from '../../shared/src/engine'
import { createApp } from '../src/app'
import type { Bindings } from '../src/types'
import { runSql, testDb, type TestDb } from './d1'

const P1 = 'p1@example.test'
const P2 = 'p2@example.test'
const BASE = 'http://localhost:8787'
const APRIL_1 = '2027-04-01'
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

async function send(method: string, path: string, body: unknown, today = APRIL_1, who = P1) {
  const res = await app.request(`${BASE}${path}`, { method, headers: headers(today), body: JSON.stringify(body) }, env(who))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
const post = (path: string, body: unknown, who = P1, today = APRIL_1) => send('POST', path, body, today, who)
const patch = (path: string, body: unknown, who = P1, today = APRIL_1) => send('PATCH', path, body, today, who)

async function load(today = APRIL_1) {
  const res = await app.request(`${BASE}/api/data`, { headers: headers(today) }, env())
  const base = (await res.json()) as BaseResponse
  const pages = await Promise.all(
    Array.from({ length: base.operationPages }, async (_, k) =>
      (await app.request(`${BASE}/api/data/operations/${k}`, { headers: headers(today) }, env())).json(),
    ),
  )
  return decodeData(assemble(base, pages as never))
}
const ledgerOf = async () => new Ledger(budgetData(await load()) as NonNullable<ReturnType<typeof budgetData>>)
const operationOf = async (id: number) => (await load()).operations.find((o) => o.id === id)!
const partsOf = async (id: number) => (await load()).parts.filter((p) => p.operationId === id).map((p) => [p.categoryId, p.amountCents])

const emptyMonth = async () => {
  await t.reset()
  await runSql(t.db, seedSql(toSeed(exampleSeedInput({ withoutOperations: true }), [P1, P2])))
}

const entry = (valueDate: string, amount: number, categoryId: number | null = null, comment: string | null = null) => ({
  valueDate,
  amountCents: euros(amount),
  categoryId,
  comment,
})

/** Enters one operation, returns its id. */
async function enter(valueDate: string, amount: number, categoryId: number | null = null, who = P1): Promise<number> {
  const out = await post('/api/operations', { items: [entry(valueDate, amount, categoryId)] }, who)
  expect(out.status).toBe(200)
  return (out.body.ids as number[])[0] as number
}

describe('the example month entered and categorized by hand (spec 1.3)', () => {
  beforeAll(emptyMonth)

  it('Shehzaad and Mary enter the operations, some with a category, some without', async () => {
    // Person 1 enters several at once, the salaries on the same day.
    const first = await post('/api/operations', {
      items: [
        entry('2027-03-01', 2800, CAT.salaryPerson1),
        entry('2027-03-01', 2200, CAT.salaryPerson2),
        entry('2027-03-05', -1200, CAT.housing),
        entry('2027-03-06', -210),
        entry('2027-03-12', -95),
        entry('2027-03-15', -150, CAT.energy),
        entry('2027-03-15', -400, CAT.childcare),
      ],
    })
    expect(first.status).toBe(200)
    const second = await post(
      '/api/operations',
      {
        items: [
          entry('2027-03-20', -260, null, 'Courses et croquettes'),
          entry('2027-03-22', -372, CAT.insuranceHome),
          entry('2027-03-25', -300, CAT.savingsAccount),
          entry('2027-03-28', -35),
          entry('2027-03-29', 20),
          entry('2027-04-01', -230),
        ],
      },
      P2,
    )
    expect(second.status).toBe(200)
    const d = await load()
    expect(d.operations).toHaveLength(13)
    expect(d.operations.every((o) => o.origin === 'manual' && o.opDate === o.valueDate)).toBe(true)
    expect(d.operations.find((o) => o.amountCents === euros(-260))).toMatchObject({ comment: 'Courses et croquettes', createdBy: 'Bob' })
    expect(d.parts.filter((p) => p.categoryId === null)).toHaveLength(6)
  })

  it('« Enregistrer N opérations » categorizes the rest, a split one included', async () => {
    const d = await load()
    const byAmount = (a: number) => d.operations.find((o) => o.amountCents === euros(a))!
    const one = (a: number, categoryId: number) => ({ id: byAmount(a).id, rowVersion: byAmount(a).rowVersion, parts: [{ categoryId, amountCents: euros(a) }] })
    const out = await post(
      '/api/operations/categorize',
      {
        items: [
          one(-210, CAT.supermarket),
          one(-95, CAT.butcher),
          {
            id: byAmount(-260).id,
            rowVersion: byAmount(-260).rowVersion,
            parts: [
              { categoryId: CAT.supermarket, amountCents: euros(-215) },
              { categoryId: CAT.cats, amountCents: euros(-45) },
            ],
          },
          one(-35, CAT.pharmacy),
          { ...one(20, CAT.pharmacy), comment: 'Remboursement' },
          one(-230, CAT.supermarket),
        ],
      },
      P2,
    )
    expect(out.status).toBe(200)
    const after = await load()
    expect(after.parts.filter((p) => p.categoryId === null)).toHaveLength(0)
    expect(after.parts.filter((p) => p.operationId === byAmount(-260).id)).toHaveLength(2)
    expect(after.operations.find((o) => o.amountCents === euros(20))?.comment).toBe('Remboursement')
  })

  it('gives the results of the closed month of 1.3', async () => {
    const ledger = await ledgerOf()
    const s = ledger.monthSummary('2027-03')
    expect(s.plannedNetCents).toBe(euros(1600))
    expect(s.actualNetCents).toBe(euros(1998))
    expect(s.gapCents).toBe(euros(398))
    expect(s.actualEndBalanceCents).toBe(euros(4998))
    const actual = (id: number) => ledger.actual(id, '2027-03') / 100
    expect([CAT.salaries, CAT.housing, CAT.groceries, CAT.cats, CAT.energy, CAT.childcare, CAT.insurance, CAT.savingsAccount, CAT.health].map(actual)).toEqual([
      5000, -1200, -565, -45, -150, -400, -372, -300, -15,
    ])
    // The operation of 01/04 counts in April (R6, value date).
    expect(ledger.actual(CAT.groceries, '2027-04')).toBe(euros(-230))
  })
})

describe('manual entry: the rules of the server', () => {
  beforeEach(emptyMonth)

  it('R5: refuses an unconfirmed duplicate of an operation already there, accepts it confirmed', async () => {
    await enter('2027-03-06', -210)
    const twice = await post('/api/operations', { items: [entry('2027-03-06', -210)] }, P2)
    expect(twice).toEqual({ status: 422, body: { error: 'duplicate_unconfirmed' } })
    const confirmed = await post('/api/operations', { items: [{ ...entry('2027-03-06', -210), confirmDuplicate: true }] }, P2)
    expect(confirmed.status).toBe(200)
    expect((await load()).operations).toHaveLength(2)
  })

  it('R5: within one request, a later entry like an earlier one is confirmed; nothing is written otherwise', async () => {
    const both = [entry('2027-03-06', -12), entry('2027-03-06', -12)]
    expect((await post('/api/operations', { items: both })).body.error).toBe('duplicate_unconfirmed')
    expect((await load()).operations).toHaveLength(0)
    expect((await post('/api/operations', { items: [both[0], { ...both[1], confirmDuplicate: true }] })).status).toBe(200)
  })

  it('R5 ignores a deleted entry', async () => {
    const id = await enter('2027-03-06', -210)
    await post(`/api/operations/${id}/delete`, { rowVersion: 1 })
    expect((await post('/api/operations', { items: [entry('2027-03-06', -210)] })).status).toBe(200)
  })

  it('R6: refuses a value date on or before the opening balance, or after December N+3', async () => {
    expect((await post('/api/operations', { items: [entry('2027-02-28', -10)] })).body.error).toBe('value_date_too_early')
    expect((await post('/api/operations', { items: [entry('2031-01-01', -10)] })).body.error).toBe('value_date_too_far')
    expect((await post('/api/operations', { items: [entry('2030-12-31', -10)] })).status).toBe(200)
  })

  it('refuses an amount of 0 and a category where nothing can be put (R2)', async () => {
    expect((await post('/api/operations', { items: [entry('2027-03-06', 0)] })).status).toBe(400)
    // Courses has subcategories: its parts go in one of them.
    expect((await post('/api/operations', { items: [entry('2027-03-06', -10, CAT.groceries)] })).body.error).toBe('category_not_choosable')
    const cat = (await load()).categories.find((c) => c.id === CAT.pharmacy)!
    await post(`/api/categories/${CAT.pharmacy}/archive`, { rowVersion: cat.rowVersion })
    expect((await post('/api/operations', { items: [entry('2027-03-06', -10, CAT.pharmacy)] })).body.error).toBe('category_not_choosable')
    expect((await load()).operations).toHaveLength(0)
  })
})

describe('the record of an operation', () => {
  beforeEach(emptyMonth)

  it('changes the amount of a split entry: the first part takes the difference', async () => {
    const id = await enter('2027-03-20', -260)
    const split = [
      { categoryId: CAT.supermarket, amountCents: euros(-215) },
      { categoryId: CAT.cats, amountCents: euros(-45) },
    ]
    expect((await patch(`/api/operations/${id}`, { rowVersion: 1, parts: split }, P2)).status).toBe(200)
    const v = (await operationOf(id)).rowVersion
    expect((await patch(`/api/operations/${id}`, { rowVersion: v, amountCents: euros(-270) })).status).toBe(200)
    expect(await partsOf(id)).toEqual([
      [CAT.supermarket, euros(-225)],
      [CAT.cats, euros(-45)],
    ])
    // -40 € would leave the first part at +5 €: refused.
    const w = (await operationOf(id)).rowVersion
    expect((await patch(`/api/operations/${id}`, { rowVersion: w, amountCents: euros(-40) })).body.error).toBe('part_sign')
  })

  it('reducing a split erases the extra parts', async () => {
    const id = await enter('2027-03-20', -260)
    const three = [
      { categoryId: CAT.supermarket, amountCents: euros(-200) },
      { categoryId: CAT.cats, amountCents: euros(-45) },
      { categoryId: CAT.butcher, amountCents: euros(-15) },
    ]
    await patch(`/api/operations/${id}`, { rowVersion: 1, parts: three })
    const v = (await operationOf(id)).rowVersion
    expect((await patch(`/api/operations/${id}`, { rowVersion: v, parts: [{ categoryId: CAT.supermarket, amountCents: euros(-260) }] })).status).toBe(200)
    expect(await partsOf(id)).toEqual([[CAT.supermarket, euros(-260)]])
    expect(Number(await t.db.prepare('SELECT count(*) AS n FROM operation_part').first('n'))).toBe(1)
  })

  it('refuses parts that do not add up, a split part with no category, and going back to « à catégoriser »', async () => {
    const id = await enter('2027-03-20', -260, CAT.supermarket)
    const bad = (parts: unknown) => patch(`/api/operations/${id}`, { rowVersion: 1, parts })
    expect((await bad([{ categoryId: CAT.supermarket, amountCents: euros(-250) }])).body.error).toBe('parts_sum')
    expect(
      (
        await bad([
          { categoryId: CAT.supermarket, amountCents: euros(-215) },
          { categoryId: null, amountCents: euros(-45) },
        ])
      ).body.error,
    ).toBe('part_uncategorized')
    expect((await bad([{ categoryId: null, amountCents: euros(-260) }])).body.error).toBe('uncategorize_refused')
  })

  it('keeps a category the operation already had, even when no longer choosable (R2, « sans détail »)', async () => {
    const id = await enter('2027-03-20', -50, CAT.energy)
    // Énergie gets its first subcategory: Énergie itself can no longer be chosen (R10)…
    const sub = await post('/api/categories', { name: 'Gaz', parentId: CAT.energy, confirmFirstSub: true })
    expect(sub.status).toBe(200)
    const gas = (sub.body.ids as number[])[0] as number
    // … but the operation keeps it while its comment and amount change.
    const out = await patch(`/api/operations/${id}`, { rowVersion: 1, amountCents: euros(-55), comment: 'Régularisation' })
    expect(out.status).toBe(200)
    expect(await partsOf(id)).toEqual([[CAT.energy, euros(-55)]])
    const v = (await operationOf(id)).rowVersion
    const split = [
      { categoryId: CAT.energy, amountCents: euros(-50) },
      { categoryId: gas, amountCents: euros(-5) },
    ]
    expect((await patch(`/api/operations/${id}`, { rowVersion: v, parts: split })).status).toBe(200)
    // Another operation cannot be put in Énergie itself.
    const other = await enter('2027-03-21', -10)
    expect((await patch(`/api/operations/${other}`, { rowVersion: 1, parts: [{ categoryId: CAT.energy, amountCents: euros(-10) }] })).body.error).toBe(
      'category_not_choosable',
    )
  })

  it('R5 and R6 when a manual entry changes its amount or value date', async () => {
    await enter('2027-03-06', -210)
    const id = await enter('2027-03-07', -210)
    expect((await patch(`/api/operations/${id}`, { rowVersion: 1, valueDate: '2027-03-06' })).body.error).toBe('duplicate_unconfirmed')
    expect((await patch(`/api/operations/${id}`, { rowVersion: 1, valueDate: '2027-02-27' })).body.error).toBe('value_date_too_early')
    expect((await patch(`/api/operations/${id}`, { rowVersion: 1, valueDate: '2027-03-06', confirmDuplicate: true })).status).toBe(200)
    expect(await operationOf(id)).toMatchObject({ valueDate: '2027-03-06', opDate: '2027-03-06' })
  })

  it('« Modifié entre-temps »: a record sent on a version the other person changed is refused', async () => {
    const id = await enter('2027-03-06', -210)
    expect((await patch(`/api/operations/${id}`, { rowVersion: 1, comment: 'Anniversaire' }, P2)).status).toBe(200)
    const late = await patch(`/api/operations/${id}`, { rowVersion: 1, parts: [{ categoryId: CAT.supermarket, amountCents: euros(-210) }] }, P1)
    expect(late).toEqual({ status: 409, body: { error: 'conflict', changed: [{ table: 'operation', id }] } })
    expect(await partsOf(id)).toEqual([[null, euros(-210)]])
    expect(await operationOf(id)).toMatchObject({ comment: 'Anniversaire', updatedBy: 'Bob' })
  })

  it('« Enregistrer N opérations » is all or nothing', async () => {
    const a = await enter('2027-03-06', -210)
    const b = await enter('2027-03-12', -95)
    await patch(`/api/operations/${b}`, { rowVersion: 1, comment: 'Changé par Bob' }, P2)
    const out = await post('/api/operations/categorize', {
      items: [
        { id: a, rowVersion: 1, parts: [{ categoryId: CAT.supermarket, amountCents: euros(-210) }] },
        { id: b, rowVersion: 1, parts: [{ categoryId: CAT.butcher, amountCents: euros(-95) }] },
      ],
    })
    expect(out).toEqual({ status: 409, body: { error: 'conflict', changed: [{ table: 'operation', id: b }] } })
    expect(await partsOf(a)).toEqual([[null, euros(-210)]])
  })
})

describe('imported operations and deletion', () => {
  beforeEach(async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
  })

  it('an imported operation keeps its bank fields; its category and comment change', async () => {
    const op = await operationOf(4)
    expect((await patch('/api/operations/4', { rowVersion: op.rowVersion, amountCents: -100 })).body.error).toBe('bank_fields')
    expect((await patch('/api/operations/4', { rowVersion: op.rowVersion, valueDate: '2027-03-07' })).body.error).toBe('bank_fields')
    const out = await patch('/api/operations/4', {
      rowVersion: op.rowVersion,
      comment: 'Anniversaire',
      parts: [
        { categoryId: CAT.supermarket, amountCents: euros(-200) },
        { categoryId: CAT.cats, amountCents: euros(-10) },
      ],
    })
    expect(out.status).toBe(200)
    expect(await partsOf(4)).toEqual([
      [CAT.supermarket, euros(-200)],
      [CAT.cats, euros(-10)],
    ])
  })

  it('only a manual entry is deleted: archived, out of every calculation', async () => {
    const op = await operationOf(4)
    expect((await post('/api/operations/4/delete', { rowVersion: op.rowVersion })).body.error).toBe('not_manual')
    const before = (await ledgerOf()).balanceAt('2027-03-31')
    const id = await enter('2027-03-30', -42, CAT.pharmacy)
    expect((await ledgerOf()).balanceAt('2027-03-31')).toBe(before - 4200)
    expect((await post(`/api/operations/${id}/delete`, { rowVersion: 1 }, P2)).status).toBe(200)
    expect(await operationOf(id)).toMatchObject({ updatedBy: 'Bob' })
    expect((await operationOf(id)).archivedAt).not.toBeNull()
    expect((await ledgerOf()).balanceAt('2027-03-31')).toBe(before)
    expect((await post(`/api/operations/${id}/delete`, { rowVersion: 2 })).body.error).toBe('operation_archived')
    expect((await patch(`/api/operations/${id}`, { rowVersion: 2, comment: 'x' })).body.error).toBe('operation_archived')
  })
})
