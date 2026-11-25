// The fictitious data sets themselves: they respect the rules the database and the Worker
// will enforce, so that loading them never fails and the measures are realistic.

import { describe, expect, it } from 'vitest'
import { Ledger } from '../src/engine'
import { exampleSeedInput } from '../fixtures/example'
import { dropSql, seedSql, toSeed, type SeedInput } from '../fixtures/seed'
import { threeYearsSeedInput } from '../fixtures/three-years'

const AUTHORS = ['p1@example.test', 'p2@example.test'] as const

function checkInvariants({ data, balanceChecks }: SeedInput) {
  const opIds = new Set(data.operations.map((o) => o.id))
  const catIds = new Set(data.categories.map((c) => c.id))
  const parents = new Set(data.categories.filter((c) => c.parentId !== null).map((c) => c.parentId))
  // Parts add up to their operation, at the finest level (R2).
  const totals = new Map<number, number>()
  for (const p of data.parts) {
    expect(opIds.has(p.operationId)).toBe(true)
    if (p.categoryId !== null) {
      expect(catIds.has(p.categoryId)).toBe(true)
      expect(parents.has(p.categoryId)).toBe(false)
    }
    totals.set(p.operationId, (totals.get(p.operationId) ?? 0) + p.amountCents)
  }
  for (const o of data.operations) {
    expect(totals.get(o.id)).toBe(o.amountCents)
    // R6: nothing on or before the opening balance date.
    expect(o.valueDate > data.openingBalance.balanceDate).toBe(true)
    if (o.origin === 'manual') expect(o.opDate).toBe(o.valueDate)
  }
  // An imported operation is unique (spec 4.4).
  const keys = data.operations
    .filter((o) => o.origin === 'import')
    .map((o) => `${o.opDate}|${o.valueDate}|${o.amountCents}|${o.bankLabel}|${o.dupRank}`)
  expect(new Set(keys).size).toBe(keys.length)
  // Active versions of a line never overlap; one active override per line and month.
  const active = data.versions.filter((v) => v.replacedAt === null)
  for (const v of active) {
    for (const w of active) {
      if (v === w || v.budgetLineId !== w.budgetLineId) continue
      const vEnd = v.endMonth ?? '9999-12'
      const wEnd = w.endMonth ?? '9999-12'
      expect(v.startMonth > wEnd || w.startMonth > vEnd).toBe(true)
    }
  }
  const overrideKeys = data.overrides.filter((o) => o.removedAt === null).map((o) => `${o.budgetLineId}|${o.month}`)
  expect(new Set(overrideKeys).size).toBe(overrideKeys.length)
  // Balance checks: gap = app balance - bank balance.
  const ledger = new Ledger(data)
  for (const b of balanceChecks) expect(ledger.balanceAt(b.checkDate) - b.bankBalanceCents).toBe(b.gapCents)
}

describe('example month data set', () => {
  it('respects the rules', () => checkInvariants(exampleSeedInput()))
  it('respects the rules, entered up to 15/03', () => checkInvariants(exampleSeedInput({ enteredUpTo: '2027-03-15' })))
})

describe('three years data set', () => {
  const input = threeYearsSeedInput()

  it('respects the rules', () => checkInvariants(input))

  it('covers 36 months up to March 2027, about 170 operations a month', () => {
    const { data } = input
    expect(data.openingBalance.balanceDate).toBe('2024-03-31')
    const months = new Set(data.operations.map((o) => o.valueDate.slice(0, 7)))
    expect(months.size).toBe(36)
    expect([...months].sort().at(-1)).toBe('2027-03')
    const perMonth = data.operations.length / 36
    expect(perMonth).toBeGreaterThan(150)
    expect(perMonth).toBeLessThan(190)
  })

  it('has what the screens will show: splits, manual, archived, to categorize, versions, overrides', () => {
    const { data } = input
    const partsPerOp = new Map<number, number>()
    for (const p of data.parts) partsPerOp.set(p.operationId, (partsPerOp.get(p.operationId) ?? 0) + 1)
    expect([...partsPerOp.values()].some((n) => n > 1)).toBe(true)
    expect(data.operations.some((o) => o.origin === 'manual' && o.archivedAt === null)).toBe(true)
    expect(data.operations.some((o) => o.archivedAt !== null)).toBe(true)
    expect(data.parts.some((p) => p.categoryId === null)).toBe(true)
    expect(data.versions.some((v) => v.replacedAt !== null)).toBe(true)
    expect(data.overrides.some((o) => o.removedAt !== null)).toBe(true)
    expect(data.operations.some((o) => (o.dupRank ?? 0) > 1)).toBe(true)
    // The month in progress is approximate: some operations are still to categorize.
    expect(new Ledger(data).currentMonthEnd('2027-03').approximate).toBe(true)
  })

  it('is the same at each run', () => {
    expect(JSON.stringify(threeYearsSeedInput().data)).toBe(JSON.stringify(input.data))
  })

  it('also builds ten years', () => {
    const ten = threeYearsSeedInput({ months: 120 })
    checkInvariants(ten)
    expect(ten.data.operations.length).toBeGreaterThan(18000)
  })
})

describe('SQL of a data set', () => {
  it('quotes text and writes parents first', () => {
    const sql = seedSql(toSeed(exampleSeedInput(), AUTHORS))
    expect(sql.indexOf('INSERT INTO section')).toBeLessThan(sql.indexOf('INSERT INTO category'))
    expect(sql.indexOf('INSERT INTO operation ')).toBeLessThan(sql.indexOf('INSERT INTO operation_part'))
    expect(sql).toContain("'Énergie'")
    expect(sql).not.toMatch(/BEGIN|COMMIT/)
  })

  it('escapes quotes', () => {
    const input = exampleSeedInput()
    input.data.budgetLines[0]!.label = "L'ancien prêt"
    expect(seedSql(toSeed(input, AUTHORS))).toContain("'L''ancien prêt'")
  })

  it('drops the migration history too', () => {
    expect(dropSql()).toContain('DROP TABLE IF EXISTS d1_migrations;')
  })
})
