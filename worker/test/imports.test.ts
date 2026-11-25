// Lot 10: import of a statement and balance check (spec 1.4 case C, 3.2, 4.4, U8, R6, R8, R9).
// The rows are those of the fictitious export (shared/fixtures/files/export-exemple.xlsx), as
// the app reads and sends them.

import { readFileSync } from 'node:fs'
import { readSheet } from 'read-excel-file/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  API_VERSION,
  API_VERSION_HEADER,
  MAX_IMPORT_ROWS,
  SIMULATED_TODAY_HEADER,
  type BaseResponse,
  type ImportPreview,
  type ImportRowRequest,
} from '../../shared/src/api'
import { readStatement, type SheetRows, type Statement } from '../../shared/src/statement'
import { assemble, budgetData, decodeData } from '../../shared/src/wire'
import { CAT, euros, exampleSeedInput } from '../../shared/fixtures/example'
import { seedSql, toSeed } from '../../shared/fixtures/seed'
import { Ledger } from '../../shared/src/engine'
import { createApp } from '../src/app'
import type { Bindings } from '../src/types'
import { here, runSql, testDb, type TestDb } from './d1'

const P1 = 'p1@example.test'
const P2 = 'p2@example.test'
const BASE = 'http://localhost:8787'
/** The day the fictitious statement was downloaded. */
const APRIL_2 = '2027-04-02'
const app = createApp()
let t: TestDb
let statement: Statement
beforeAll(async () => {
  t = await testDb()
  const sheet = await readSheet(readFileSync(here('../../shared/fixtures/files/export-exemple.xlsx')), { parseNumber: (s: string) => s })
  const read = readStatement(sheet as SheetRows, MAX_IMPORT_ROWS)
  if ('error' in read) throw new Error(read.error)
  statement = read
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

async function post(path: string, body: unknown, who = P1, today = APRIL_2) {
  const res = await app.request(`${BASE}${path}`, { method: 'POST', headers: headers(today), body: JSON.stringify(body) }, env(who))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function load(today = APRIL_2) {
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

const seed = async (options = { withoutOperations: true }) => {
  await t.reset()
  await runSql(t.db, seedSql(toSeed(exampleSeedInput(options), [P1, P2])))
}

/** What the app sends: the rows (raw first line of the label) and the « Solde au ». */
const sent = (rows = statement.rows, balance = statement.balance) => ({
  balance,
  rows: rows.map((r): ImportRowRequest => ({ opDate: r.opDate, valueDate: r.valueDate, amountCents: r.amountCents, bankLabelRaw: r.bankLabelRaw })),
})

async function preview(body = sent()): Promise<ImportPreview> {
  const out = await post('/api/import/preview', body)
  expect(out.status).toBe(200)
  return out.body as unknown as ImportPreview
}

const commit = (p: ImportPreview, pairs: { rowIndex: number; operationId: number }[] = [], body = sent(), who = P1) =>
  post('/api/import', { ...body, token: p.token, pairs }, who)

async function enter(valueDate: string, amount: number, categoryId: number | null = null, who = P1): Promise<number> {
  const out = await post('/api/operations', { items: [{ valueDate, amountCents: euros(amount), categoryId, comment: null }] }, who)
  expect(out.status).toBe(200)
  return (out.body.ids as number[])[0] as number
}

const supermarketRow = () => statement.rows.findIndex((r) => r.valueDate === '2027-03-06')

describe('the fictitious export is read as the app reads it (spec 4.4, step 2)', () => {
  it('13 operations, +1,998 € in March, a balance of 4,768 € on 02/04/2027', () => {
    expect(statement.rows).toHaveLength(13)
    expect(statement.balance).toEqual({ date: APRIL_2, balanceCents: euros(4768) })
    const march = statement.rows.filter((r) => r.valueDate.startsWith('2027-03')).reduce((s, r) => s + r.amountCents, 0)
    expect(march).toBe(euros(1998))
  })
})

describe('case C, merge refused (spec 1.4)', () => {
  let manual = 0
  beforeAll(async () => {
    await seed()
    manual = await enter('2027-03-06', -210, CAT.supermarket, P2)
  })

  it('sums up: 0 already present, 1 manual entry to merge, 12 new; C7 before the import', async () => {
    const p = await preview()
    expect(p.excluded).toEqual([])
    expect(p.alreadyPresent).toEqual([])
    expect(p.toMerge).toEqual([{ valueDate: '2027-03-06', amountCents: euros(-210), rowIndexes: [supermarketRow()], operationIds: [manual] }])
    expect(p.fresh).toHaveLength(12)
    expect(p.appBalanceCents).toBe(euros(2790))
  })

  it('imports 13 rows beside the manual entry and finds a gap of -210 € on 02/04/2027', async () => {
    const out = await commit(await preview())
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ imported: 13, merged: 0, check: { date: APRIL_2, bankBalanceCents: euros(4768), gapCents: euros(-210) } })
    const d = await load()
    expect(d.operations).toHaveLength(14)
    expect(d.parts).toHaveLength(14)
    expect(d.parts.filter((p) => p.categoryId === null)).toHaveLength(13)
    expect(d.operations.filter((o) => o.origin === 'import').every((o) => o.createdBy === 'Alice' && o.dupRank === 1)).toBe(true)
    expect((await ledgerOf()).balanceAt(APRIL_2)).toBe(euros(4558))
    expect(d.balanceChecks).toEqual([expect.objectContaining({ checkDate: APRIL_2, bankBalanceCents: euros(4768), gapCents: euros(-210), createdBy: 'Alice' })])
  })

  it('once the manual entry is deleted, a check finds no gap', async () => {
    const op = (await load()).operations.find((o) => o.id === manual)!
    expect((await post(`/api/operations/${manual}/delete`, { rowVersion: op.rowVersion })).status).toBe(200)
    const out = await post('/api/balance-checks', { bankBalanceCents: euros(4768) }, P2)
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ check: { date: APRIL_2, bankBalanceCents: euros(4768), gapCents: 0 } })
    expect((await load()).balanceChecks.map((c) => [c.gapCents, c.createdBy])).toEqual([
      [euros(-210), 'Alice'],
      [0, 'Bob'],
    ])
  })

  it('reimporting the same file finds 13 operations already present', async () => {
    const p = await preview()
    expect(p.alreadyPresent).toHaveLength(13)
    expect([...p.fresh, ...p.toMerge]).toEqual([])
    const out = await commit(p)
    expect(out.body).toMatchObject({ imported: 0, merged: 0, check: { gapCents: 0 } })
    expect((await load()).operations).toHaveLength(14)
  })
})

describe('case C, merge confirmed (control)', () => {
  let manual = 0
  beforeAll(async () => {
    await seed()
    manual = await enter('2027-03-06', -210, CAT.supermarket, P2)
  })

  it('keeps 13 operations, the former manual entry imported and still in Courses > Supermarché; no gap', async () => {
    const p = await preview()
    const out = await commit(p, [{ rowIndex: supermarketRow(), operationId: manual }])
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ imported: 12, merged: 1, check: { gapCents: 0 } })
    const d = await load()
    expect(d.operations).toHaveLength(13)
    expect(d.operations.every((o) => o.origin === 'import')).toBe(true)
    const merged = d.operations.find((o) => o.id === manual)!
    expect(merged).toMatchObject({ opDate: '2027-03-06', bankLabel: 'PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE 05/03 - VILLE EXEMPLE', dupRank: 1, createdBy: 'Bob', updatedBy: 'Alice' })
    expect(merged.bankLabelRaw).toBe('PAIEMENT PAR CARTE - X0000 SUPERMARCHE EXEMPLE 05/03 - VILLE EXEMPLE')
    expect(d.parts.filter((p) => p.operationId === manual).map((p) => p.categoryId)).toEqual([CAT.supermarket])
    expect((await ledgerOf()).balanceAt(APRIL_2)).toBe(euros(4768))
  })

  it('reimporting the same file finds 13 operations already present', async () => {
    expect((await preview()).alreadyPresent).toHaveLength(13)
  })
})

describe('other cases of spec 4.4', () => {
  it('a manual -230 € valued 01/04 merges with the row dated 31/03, then is recognized', async () => {
    await seed()
    const manual = await enter('2027-04-01', -230, CAT.supermarket)
    const p = await preview()
    expect(p.toMerge).toEqual([{ valueDate: '2027-04-01', amountCents: euros(-230), rowIndexes: [0], operationIds: [manual] }])
    expect((await commit(p, [{ rowIndex: 0, operationId: manual }])).status).toBe(200)
    expect((await load()).operations.find((o) => o.id === manual)).toMatchObject({ opDate: '2027-03-31', valueDate: '2027-04-01', origin: 'import' })
    expect((await preview()).alreadyPresent).toHaveLength(13)
  })

  it('a deleted manual entry is never offered to merge: the row comes as new', async () => {
    await seed()
    const manual = await enter('2027-04-01', -230)
    const op = (await load()).operations.find((o) => o.id === manual)!
    await post(`/api/operations/${manual}/delete`, { rowVersion: op.rowVersion })
    const p = await preview()
    expect(p.toMerge).toEqual([])
    expect(p.fresh).toHaveLength(13)
  })

  it('rows valued on or before the opening balance are set aside (R6)', async () => {
    await seed()
    const early = { ...statement.rows[0]!, opDate: '2027-02-27', valueDate: '2027-02-28', bankLabelRaw: 'PRELEVEMENT - EXEMPLE ANCIEN' }
    const p = await preview(sent([early, ...statement.rows]))
    expect(p.excluded).toEqual([0])
    const out = await commit(p, [], sent([early, ...statement.rows]))
    expect(out.body).toMatchObject({ imported: 13, check: { gapCents: 0 } })
  })

  it('refuses a pair outside the sort, writes nothing', async () => {
    await seed()
    const manual = await enter('2027-03-06', -210)
    const p = await preview()
    const out = await commit(p, [{ rowIndex: 0, operationId: manual }])
    expect(out).toMatchObject({ status: 400, body: { reason: 'pairs' } })
    expect((await load()).operations).toHaveLength(1)
  })
})

describe('no duplicate, even when two imports cross (spec 4.4)', () => {
  it('an import on an older sort writes nothing and gets the new sort', async () => {
    await seed()
    const first = await preview()
    const second = await preview()
    expect((await commit(first)).status).toBe(200)
    const out = await commit(second, [], sent(), P2)
    expect(out.status).toBe(409)
    expect(out.body.error).toBe('import_changed')
    expect((out.body.preview as ImportPreview).alreadyPresent).toHaveLength(13)
    expect((await load()).operations).toHaveLength(13)
  })

  it('two imports sent at the same time store each operation once', async () => {
    await seed()
    const p = await preview()
    const outs = await Promise.all([commit(p, [], sent(), P1), commit(p, [], sent(), P2)])
    expect(outs.map((o) => o.status).sort()).toEqual([200, 409])
    const d = await load()
    expect(d.operations).toHaveLength(13)
    expect(d.balanceChecks).toHaveLength(1)
  })

  it('an entry made between the sort and the import changes the sort: nothing is written', async () => {
    await seed()
    const p = await preview()
    const manual = await enter('2027-03-06', -210)
    const out = await commit(p)
    expect(out.status).toBe(409)
    expect((out.body.preview as ImportPreview).toMerge[0]?.operationIds).toEqual([manual])
    expect((await load()).operations).toHaveLength(1)
  })

  it('identical rows get ranks 1 and 2; one more identical row later gets rank 3', async () => {
    await seed()
    const row = { opDate: '2027-03-10', valueDate: '2027-03-10', amountCents: euros(-4), bankLabelRaw: 'PAIEMENT PAR CARTE - X0000 BOULANGERIE EXEMPLE 10/03 - VILLE' }
    const two = { balance: statement.balance, rows: [row, row] }
    expect((await commit(await preview(two), [], two)).status).toBe(200)
    const three = { balance: statement.balance, rows: [row, row, row] }
    const p = await preview(three)
    expect(p.alreadyPresent).toEqual([0, 1])
    expect((await commit(p, [], three)).status).toBe(200)
    expect((await load()).operations.map((o) => o.dupRank).sort()).toEqual([1, 2, 3])
  })
})

describe('checks of the requests', () => {
  it('refuses an import before setup, an empty or malformed statement', async () => {
    await t.reset()
    expect((await post('/api/import/preview', sent())).status).toBe(422)
    await seed()
    expect((await post('/api/import/preview', { balance: statement.balance, rows: [] })).status).toBe(400)
    const bad = sent()
    bad.rows[0]!.bankLabelRaw = 'DEUX\nLIGNES'
    expect((await post('/api/import/preview', bad)).status).toBe(400)
    const zero = sent()
    zero.rows[0]!.amountCents = 0
    expect((await post('/api/import/preview', zero)).status).toBe(400)
    expect((await post('/api/import/preview', { balance: { date: '2027-02-30', balanceCents: 0 }, rows: sent().rows })).status).toBe(400)
    expect((await post('/api/balance-checks', { bankBalanceCents: 1.5 })).status).toBe(400)
  })
})

describe('balance check by hand (U8)', () => {
  it('on the example month, the app balance on 31/03 is 4,998 €: identical, or a gap', async () => {
    await seed({ withoutOperations: false })
    const today = '2027-03-31'
    const same = await post('/api/balance-checks', { bankBalanceCents: euros(4998) }, P1, today)
    expect(same.body).toMatchObject({ check: { date: today, gapCents: 0 } })
    const off = await post('/api/balance-checks', { bankBalanceCents: euros(5000) }, P1, today)
    expect(off.body).toMatchObject({ check: { gapCents: euros(-2) } })
  })
})

describe('a long statement (spec 4.3: one all-or-nothing batch)', () => {
  it(`imports ${MAX_IMPORT_ROWS} rows at once, each with its part to categorize`, async () => {
    await seed()
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => {
      const day = new Date(Date.UTC(2027, 2, 1 + (i % 400)))
      const d = day.toISOString().slice(0, 10)
      return { opDate: d, valueDate: d, amountCents: -(100 + i), bankLabelRaw: `PAIEMENT PAR CARTE - X0000 COMMERCE ${i} 01/03 - VILLE` }
    })
    const body = { balance: { date: '2028-04-04', balanceCents: 0 }, rows }
    const p = await preview(body)
    expect(p.fresh).toHaveLength(MAX_IMPORT_ROWS)
    const out = await commit(p, [], body)
    expect(out.status).toBe(200)
    expect(out.body.imported).toBe(MAX_IMPORT_ROWS)
    const d = await load('2028-04-04')
    expect(d.operations).toHaveLength(MAX_IMPORT_ROWS)
    expect(d.parts).toHaveLength(MAX_IMPORT_ROWS)
    expect(d.parts.every((p) => p.amountCents === d.operations.find((o) => o.id === p.operationId)?.amountCents)).toBe(true)
  }, 60_000)
})
