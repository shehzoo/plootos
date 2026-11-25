// Lot 11: the export file and the lots of a restore (spec 3.8, 4.6).

import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, TABLE_COLUMNS } from '../src/api'
import {
  buildExport,
  EXPORT_FORMAT,
  exportDue,
  exportFileName,
  readExport,
  RESTORE_ORDER,
  restoreLots,
  type ExportFile,
} from '../src/backup'
import { exampleSeedInput } from '../fixtures/example'
import { seedResponse, toSeed } from '../fixtures/seed'
import { threeYearsSeedInput } from '../fixtures/three-years'

const AUTHORS = ['p1@example.test', 'p2@example.test'] as const
const USERS = new Map([
  ['p1@example.test', 'Alice'],
  ['p2@example.test', 'Bob'],
])
const AT = '2027-04-01T08:30:00.000Z'
const example = () => seedResponse(toSeed(exampleSeedInput(), AUTHORS), USERS, '2027-04-01')
const fileOf = (environment: 'local' | 'staging' | 'production' = 'local') => buildExport({ ...example(), environment }, 'Alice', AT)
const text = (f: ExportFile | Record<string, unknown>) => JSON.stringify(f)

describe('the export file', () => {
  it('holds the format, schema, date, author, environment and every table with its columns', () => {
    const f = fileOf()
    expect(f).toMatchObject({ format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: AT, exportedBy: 'Alice', environment: 'local' })
    expect(Object.keys(f.tables)).toEqual(RESTORE_ORDER)
    for (const t of RESTORE_ORDER) expect(f.tables[t]?.columns).toEqual(TABLE_COLUMNS[t])
    expect(f.tables.operation?.rows).toHaveLength(13)
    expect(text(f)).not.toContain('@')
  })

  it('reads back with a summary: date, author, operations, budget lines, period', () => {
    const read = readExport(text(fileOf()), 'local')
    if (!read.ok) throw new Error(read.error)
    expect(read.file.tables).toEqual(fileOf().tables)
    expect(read.summary).toMatchObject({ exportedAt: AT, exportedBy: 'Alice', operations: 13, from: '2027-02-28', to: '2027-04-01' })
    expect(read.summary.budgetLines).toBe(fileOf().tables.budget_line?.rows.length)
  })

  it('accepts columns in another order', () => {
    const f = fileOf()
    const ops = f.tables.operation as { columns: string[]; rows: (string | number | null)[][] }
    f.tables.operation = { columns: [...ops.columns].reverse(), rows: ops.rows.map((r) => [...r].reverse()) }
    const read = readExport(text(f), 'local')
    expect(read.ok && read.file.tables.operation).toEqual(fileOf().tables.operation)
  })

  it('names the file after its day in Paris, and its environment outside production', () => {
    expect(exportFileName('production', '2027-03-15T23:30:00.000Z')).toBe('plootos-export-2027-03-16.json')
    expect(exportFileName('staging', AT)).toBe('plootos-recette-export-2027-04-01.json')
    expect(exportFileName('local', AT)).toBe('plootos-local-export-2027-04-01.json')
  })
})

describe('a chosen file refused (spec 3.8)', () => {
  it('not a Plootos export', () => {
    expect(readExport('pas du JSON', 'local')).toEqual({ ok: false, error: 'not_export' })
    expect(readExport(text({ format: 'autre' }), 'local')).toEqual({ ok: false, error: 'not_export' })
  })

  it('made by a newer version of the app', () => {
    expect(readExport(text({ ...fileOf(), schemaVersion: SCHEMA_VERSION + 1 }), 'local')).toEqual({ ok: false, error: 'newer_schema' })
  })

  it('from another kind of environment: production only in production (DECISIONS.md, 2026-11-25)', () => {
    expect(readExport(text(fileOf('production')), 'staging')).toEqual({ ok: false, error: 'other_environment' })
    expect(readExport(text(fileOf('production')), 'local')).toEqual({ ok: false, error: 'other_environment' })
    expect(readExport(text(fileOf('staging')), 'production')).toEqual({ ok: false, error: 'other_environment' })
    expect(readExport(text(fileOf('staging')), 'local').ok).toBe(true)
    expect(readExport(text(fileOf('production')), 'production').ok).toBe(true)
  })

  it('damaged: a missing or unknown table, a wrong row, no opening balance', () => {
    const missing = fileOf()
    delete missing.tables.operation_part
    expect(readExport(text(missing), 'local')).toEqual({ ok: false, error: 'invalid' })
    expect(readExport(text({ ...fileOf(), tables: { ...fileOf().tables, autre: { columns: [], rows: [] } } }), 'local')).toEqual({ ok: false, error: 'invalid' })
    const short = fileOf()
    short.tables.section?.rows[0]?.pop()
    expect(readExport(text(short), 'local')).toEqual({ ok: false, error: 'invalid' })
    const opening = fileOf()
    ;(opening.tables.opening_balance as { rows: unknown[] }).rows = []
    expect(readExport(text(opening), 'local')).toEqual({ ok: false, error: 'invalid' })
    expect(readExport(text({ ...fileOf(), exportedAt: 'hier' }), 'local')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('lots of a restore (spec 4.3)', () => {
  it('parents first, categories before subcategories, the opening balance and the counts in the last lot', () => {
    const f = fileOf()
    const lots = restoreLots(f, 5)
    expect(lots.every((l, i) => l.lot === i && l.lots === lots.length)).toBe(true)
    expect(lots.every((l) => Object.values(l.tables).reduce((n, r) => n + (r?.length ?? 0), 0) <= 5 || l.lot === lots.length - 1)).toBe(true)
    const last = lots[lots.length - 1]
    expect(last?.tables.opening_balance).toHaveLength(1)
    expect(lots.slice(0, -1).some((l) => l.tables.opening_balance || l.counts)).toBe(false)
    expect(last?.counts?.operation).toBe(13)
    const parent = TABLE_COLUMNS.category.indexOf('parent_id')
    const categories = lots.flatMap((l) => l.tables.category ?? [])
    const firstSub = categories.findIndex((r) => r[parent] !== null)
    expect(categories.slice(firstSub).every((r) => r[parent] !== null)).toBe(true)
    const order = lots.flatMap((l) => Object.keys(l.tables))
    expect(order.indexOf('operation')).toBeLessThan(order.indexOf('operation_part'))
    expect(lots.flatMap((l) => l.tables.operation ?? [])).toEqual(f.tables.operation?.rows)
  })

  it('keeps each lot of three years under its size', () => {
    const f = buildExport(seedResponse(toSeed(threeYearsSeedInput(), AUTHORS), USERS, '2027-04-01'), 'Alice', AT)
    const lots = restoreLots(f, 2000, 200_000)
    expect(lots.length).toBeGreaterThan(1)
    for (const l of lots) expect(JSON.stringify(l.tables).length).toBeLessThan(205_000)
  })
})

describe('reminder to export (spec 3.8)', () => {
  it('after more than a month since the last export', () => {
    expect(exportDue('2027-03-15T10:00:00.000Z', '2026-01-01T10:00:00.000Z', '2027-04-15')).toBeNull()
    expect(exportDue('2027-03-15T10:00:00.000Z', '2026-01-01T10:00:00.000Z', '2027-04-16')).toBe('2027-03-15')
    // The end of a longer month counts as the end of the shorter one.
    expect(exportDue('2027-01-31T10:00:00.000Z', '2026-01-01T10:00:00.000Z', '2027-02-28')).toBeNull()
    expect(exportDue('2027-01-31T10:00:00.000Z', '2026-01-01T10:00:00.000Z', '2027-03-01')).toBe('2027-01-31')
    // Days in Paris time.
    expect(exportDue('2027-03-14T23:30:00.000Z', '2026-01-01T10:00:00.000Z', '2027-04-15')).toBeNull()
  })

  it('without any export, from setup (DECISIONS.md, 2026-11-25)', () => {
    expect(exportDue(null, '2027-03-01T09:00:00.000Z', '2027-04-01')).toBeNull()
    expect(exportDue(null, '2027-03-01T09:00:00.000Z', '2027-04-02')).toBe('2027-03-01')
  })
})
