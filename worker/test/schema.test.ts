// Migration 0001: the tables of spec 4.5 and what the database itself guarantees.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TABLE_COLUMNS, TABLE_NAMES } from '../../shared/src/api'
import { DROP_ORDER, INSERT_ORDER, seedSql, toSeed } from '../../shared/fixtures/seed'
import { exampleSeedInput } from '../../shared/fixtures/example'
import { migrationFiles, runSql, testDb, type TestDb } from './d1'

const AUTHORS = ['p1@example.test', 'p2@example.test'] as const
const T = "'p1@example.test', '2027-03-01T00:00:00.000Z', 'p1@example.test', '2027-03-01T00:00:00.000Z'"
const TRACE = 'created_by, created_at, updated_by, updated_at'

let t: TestDb
beforeAll(async () => {
  t = await testDb()
}, 60_000)
afterAll(async () => t?.dispose())
beforeEach(async () => {
  await t.reset()
  await runSql(t.db, seedSql(toSeed(exampleSeedInput(), AUTHORS)))
})

const run = (sql: string) => t.db.prepare(sql).run()
const fails = async (sql: string, pattern: RegExp) => {
  await expect(run(sql)).rejects.toThrow(pattern)
}

describe('tables', () => {
  it('has every column the app reads, for every table', async () => {
    for (const table of TABLE_NAMES) {
      const info = await t.db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()
      const names = info.results.map((r) => r.name)
      for (const c of TABLE_COLUMNS[table]) expect(names, `${table}.${c}`).toContain(c)
    }
  })

  it('drops and fills every table it creates', async () => {
    const tables = await t.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
      .all<{ name: string }>()
    for (const { name } of tables.results) expect(DROP_ORDER as readonly string[]).toContain(name)
    for (const name of TABLE_NAMES) expect(INSERT_ORDER).toContain(name)
  })

  it('keeps schema_version equal to the number of migrations', async () => {
    const meta = await t.db.prepare('SELECT schema_version FROM meta').first<number>('schema_version')
    expect(meta).toBe(migrationFiles().length)
    expect(migrationFiles()[0]).toBe('0001_initial.sql')
  })

  it('loads the example month', async () => {
    expect(await t.db.prepare('SELECT count(*) AS n FROM operation').first('n')).toBe(13)
    expect(await t.db.prepare('SELECT count(*) AS n FROM operation_part').first('n')).toBe(14)
  })
})

describe('constraints kept by the database (spec 4.3, 4.5)', () => {
  it('refuses a broken link', async () => {
    await fails(`INSERT INTO operation_part (operation_id, category_id, amount_cents, ${TRACE}) VALUES (999, NULL, -100, ${T})`, /FOREIGN KEY/)
    await fails(`INSERT INTO category (name, parent_id, sort_order, ${TRACE}) VALUES ('X', 999, 1, ${T})`, /FOREIGN KEY/)
  })

  it('allows a single opening balance and a single meta row', async () => {
    await fails(`INSERT INTO opening_balance (id, balance_date, amount_cents, ${TRACE}) VALUES (2, '2027-01-31', 0, ${T})`, /CHECK/)
    await fails(`INSERT INTO opening_balance (id, balance_date, amount_cents, ${TRACE}) VALUES (1, '2027-01-31', 0, ${T})`, /UNIQUE|PRIMARY/)
    await fails('INSERT INTO meta (id, schema_version) VALUES (2, 1)', /CHECK/)
  })

  it('allows one override still in force per line and month', async () => {
    const ins = `INSERT INTO budget_override (budget_line_id, month, amount_cents, ${TRACE}) VALUES (104, '2027-03', 90000, ${T})`
    await fails(ins, /UNIQUE/)
    await run("UPDATE budget_override SET removed_at = '2027-03-05T00:00:00.000Z' WHERE id = 301")
    await run(ins)
  })

  it('never stores the same imported operation twice (spec 4.4)', async () => {
    await fails(
      `INSERT INTO operation (op_date, value_date, amount_cents, origin, bank_label, bank_label_raw, dup_rank, ${TRACE})
       SELECT op_date, value_date, amount_cents, origin, bank_label, bank_label_raw, dup_rank, ${TRACE} FROM operation WHERE id = 1`,
      /UNIQUE/,
    )
    await run(
      `INSERT INTO operation (op_date, value_date, amount_cents, origin, bank_label, bank_label_raw, dup_rank, ${TRACE})
       SELECT op_date, value_date, amount_cents, origin, bank_label, bank_label_raw, 2, ${TRACE} FROM operation WHERE id = 1`,
    )
  })

  it('keeps imported and manual operations consistent', async () => {
    const op = (values: string) =>
      `INSERT INTO operation (op_date, value_date, amount_cents, origin, bank_label, bank_label_raw, dup_rank, archived_at, ${TRACE}) VALUES (${values}, ${T})`
    // Manual: no bank fields, date = value date.
    await run(op("'2027-03-10', '2027-03-10', -500, 'manual', NULL, NULL, NULL, NULL"))
    await fails(op("'2027-03-09', '2027-03-10', -500, 'manual', NULL, NULL, NULL, NULL"), /CHECK/)
    await fails(op("'2027-03-10', '2027-03-10', -500, 'manual', 'X', 'X', 1, NULL"), /CHECK/)
    // Imported: bank fields required, never archived.
    await fails(op("'2027-03-10', '2027-03-10', -500, 'import', NULL, NULL, NULL, NULL"), /CHECK/)
    await fails(op("'2027-03-10', '2027-03-10', -500, 'import', 'X', 'X', 1, '2027-03-11T00:00:00Z'"), /CHECK/)
    // Amounts are integer cents.
    await fails(op("'2027-03-10', '2027-03-10', -5.5, 'manual', NULL, NULL, NULL, NULL"), /CHECK/)
  })

  it('checks versions: positive amount, rhythm shape, end after start', async () => {
    const v = (values: string) =>
      `INSERT INTO budget_line_version (budget_line_id, category_id, amount_cents, start_month, end_month, rhythm, every_n, anchor_month, months, ${TRACE}) VALUES (103, 20, ${values}, ${T})`
    await run(v("1000, '2027-04', NULL, 'months', NULL, NULL, '1,2,12'"))
    await fails(v("0, '2027-04', NULL, 'every_n', 1, '2027-04', NULL"), /CHECK/)
    await fails(v("1000, '2027-04', '2027-03', 'every_n', 1, '2027-04', NULL"), /CHECK/)
    await fails(v("1000, '2027-04', NULL, 'every_n', 0, '2027-04', NULL"), /CHECK/)
    await fails(v("1000, '2027-04', NULL, 'every_n', 1, NULL, NULL"), /CHECK/)
    await fails(v("1000, '2027-04', NULL, 'months', NULL, NULL, '1;2'"), /CHECK/)
    await fails(v("1000, '2027-4', NULL, 'every_n', 1, '2027-04', NULL"), /CHECK/)
  })

  it('checks sections and categories', async () => {
    await fails(`INSERT INTO section (name, direction, sort_order, ${TRACE}) VALUES ('X', 'both', 9, ${T})`, /CHECK/)
    // A category has either a parent or a section.
    await fails(`INSERT INTO category (name, parent_id, section_id, sort_order, ${TRACE}) VALUES ('X', 30, 4, 1, ${T})`, /CHECK/)
    await fails(`INSERT INTO category (name, parent_id, section_id, sort_order, ${TRACE}) VALUES ('X', NULL, NULL, 1, ${T})`, /CHECK/)
  })

  it('keeps write_guard empty and refusing', async () => {
    await fails('INSERT INTO write_guard (failed) VALUES (1)', /CHECK constraint failed: guard/)
    expect(await t.db.prepare('SELECT count(*) AS n FROM write_guard').first('n')).toBe(0)
  })
})
