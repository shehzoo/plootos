// Write framework (spec 4.3): author, row_version, all-or-nothing batches, guards.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exampleSeedInput } from '../../shared/fixtures/example'
import { seedSql, toSeed } from '../../shared/fixtures/seed'
import { lastInsertedId, WriteBatch } from '../src/write'
import { runSql, testDb, type TestDb } from './d1'

const P1 = 'p1@example.test'
const P2 = 'p2@example.test'
const NOW = '2027-03-15T20:00:00.000Z'

let t: TestDb
beforeAll(async () => {
  t = await testDb()
}, 60_000)
afterAll(async () => t?.dispose())
beforeEach(async () => {
  await t.reset()
  await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
})

const batch = (author = P2) => new WriteBatch(t.db, author, NOW)
const row = (sql: string, ...params: unknown[]) => t.db.prepare(sql).bind(...params).first<Record<string, unknown>>()
const count = async (table: string) => Number(await t.db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n'))

describe('author and traceability', () => {
  it('fills created and updated on insert, with row_version 1', async () => {
    const out = await batch().insert('section', { name: 'Nouvelle', direction: 'out', sort_order: 9 }).run()
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const s = await row('SELECT * FROM section WHERE id = ?', out.insertedIds[0])
    expect(s).toMatchObject({ name: 'Nouvelle', created_by: P2, created_at: NOW, updated_by: P2, updated_at: NOW, row_version: 1 })
  })

  it('raises row_version and sets the last author on update, keeping the creator', async () => {
    const before = await row('SELECT * FROM operation WHERE id = 4')
    const out = await batch().expectVersion('operation', 4, 1).update('operation', 4, { comment: 'Anniversaire' }).run()
    expect(out.ok).toBe(true)
    const after = await row('SELECT * FROM operation WHERE id = 4')
    expect(after).toMatchObject({ comment: 'Anniversaire', row_version: 2, updated_by: P2, updated_at: NOW })
    expect(after?.created_by).toBe(before?.created_by)
    expect(after?.created_at).toBe(before?.created_at)
  })

  it('refuses a column that is not in the table, or traceability set by hand', () => {
    expect(() => batch().update('operation', 4, { nope: 1 })).toThrow()
    expect(() => batch().update('operation', 4, { updated_by: P1 })).toThrow()
    expect(() => batch().insert('section', { 'name; DROP TABLE x': 'a' })).toThrow()
  })
})

describe('two people at the same time (row_version)', () => {
  it('writes when the element is still at the version read', async () => {
    const out = await batch()
      .expectVersion('operation', 8, 1)
      .update('operation_part', 80, { category_id: 31, amount_cents: -26000 })
      .update('operation_part', 81, { category_id: 31, amount_cents: 0 })
      .touch('operation', 8)
      .run()
    expect(out.ok).toBe(true)
    expect((await row('SELECT row_version FROM operation WHERE id = 8'))?.row_version).toBe(2)
  })

  it('refuses when it changed meanwhile, and names it; nothing of the batch is written', async () => {
    // Person 1 categorizes first.
    await batch(P1).expectVersion('operation', 8, 1).update('operation', 8, { comment: 'Fait' }).run()
    // Person 2 still had version 1 of operation 8; version 1 of operation 4 is current.
    const out = await batch(P2)
      .update('operation', 4, { comment: 'Écrit avant la garde' })
      .expectVersion('operation', 4, 1)
      .expectVersion('operation', 8, 1)
      .update('operation', 8, { comment: 'Trop tard' })
      .run()
    expect(out).toEqual({ ok: false, status: 409, body: { error: 'conflict', changed: [{ table: 'operation', id: 8 }] } })
    expect((await row('SELECT comment FROM operation WHERE id = 4'))?.comment).toBeNull()
    expect((await row('SELECT comment FROM operation WHERE id = 8'))?.comment).toBe('Fait')
    expect(await count('write_guard')).toBe(0)
  })

  it('raises the budget line when a version or an override is written', async () => {
    const out = await batch()
      .expectVersion('budget_line', 104, 1)
      .update('budget_override', 301, { removed_at: NOW })
      .touch('budget_line', 104)
      .run()
    expect(out.ok).toBe(true)
    expect((await row('SELECT row_version FROM budget_line WHERE id = 104'))?.row_version).toBe(2)
    const stale = await batch(P1).expectVersion('budget_line', 104, 1).update('budget_line', 104, { label: 'Courses du mois' }).run()
    expect(stale.ok).toBe(false)
  })
})

describe('all or nothing', () => {
  it('links rows inserted in the same batch: several operations, each with its parts', async () => {
    const b = batch()
    for (const [amount, parts] of [
      [-1000, [[31, -600], [33, -400]]],
      [-500, [[32, -500]]],
    ] as [number, [number, number][]][]) {
      b.insert('operation', { op_date: '2027-03-16', value_date: '2027-03-16', amount_cents: amount, origin: 'manual' })
      for (const [category, cents] of parts) {
        b.insert('operation_part', { operation_id: lastInsertedId('operation'), category_id: category, amount_cents: cents })
      }
    }
    const out = await b.run()
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const [op1, p1, p2, op2, p3] = out.insertedIds
    expect(op1).toBe(14)
    expect(op2).toBe(15)
    expect((await row('SELECT operation_id FROM operation_part WHERE id = ?', p1))?.operation_id).toBe(op1)
    expect((await row('SELECT operation_id FROM operation_part WHERE id = ?', p2))?.operation_id).toBe(op1)
    expect((await row('SELECT operation_id FROM operation_part WHERE id = ?', p3))?.operation_id).toBe(op2)
  })

  it('writes nothing of 200 operations if the last one is refused', async () => {
    const b = batch()
    for (let i = 0; i < 199; i++) {
      b.insert('operation', { op_date: '2027-03-20', value_date: '2027-03-20', amount_cents: -100 - i, origin: 'manual' })
      b.insert('operation_part', { operation_id: lastInsertedId('operation'), category_id: 31, amount_cents: -100 - i })
    }
    // Manual operation whose date differs from its value date: refused by the database.
    b.insert('operation', { op_date: '2027-03-19', value_date: '2027-03-20', amount_cents: -1, origin: 'manual' })
    expect(b.size).toBe(1 + 2 * 199 + 1)
    const out = await b.run()
    expect(out).toEqual({ ok: false, status: 422, body: { error: 'invalid_value' } })
    expect(await count('operation')).toBe(13)
    expect(await count('operation_part')).toBe(14)
  })

  it('reports a duplicate and a broken link with fixed codes', async () => {
    const dup = await batch()
      .insert('budget_override', { budget_line_id: 104, month: '2027-03', amount_cents: 100000 })
      .run()
    expect(dup).toEqual({ ok: false, status: 409, body: { error: 'duplicate' } })
    const link = await batch().insert('operation_part', { operation_id: 999, category_id: 31, amount_cents: -1 }).run()
    expect(link).toEqual({ ok: false, status: 422, body: { error: 'invalid_link' } })
  })
})

describe('guards', () => {
  it('refuses with the code of the rule that fails now', async () => {
    const out = await batch()
      .guard('NOT EXISTS (SELECT 1 FROM operation WHERE value_date = ? AND amount_cents = ?)', ['2027-03-06', -21000], 'same_amount_and_date')
      .insert('operation', { op_date: '2027-03-06', value_date: '2027-03-06', amount_cents: -21000, origin: 'manual' })
      .run()
    expect(out).toEqual({ ok: false, status: 422, body: { error: 'same_amount_and_date' } })
    expect(await count('operation')).toBe(13)
  })

  it('refuses every write while a restore runs (spec 4.3)', async () => {
    await t.db.prepare('UPDATE meta SET restore_in_progress = 1').run()
    const out = await batch().update('operation', 4, { comment: 'x' }).run()
    expect(out).toEqual({ ok: false, status: 503, body: { error: 'restore_in_progress' } })
    await t.db.prepare('UPDATE meta SET restore_in_progress = 0').run()
    expect((await row('SELECT comment FROM operation WHERE id = 4'))?.comment).toBeNull()
  })
})
