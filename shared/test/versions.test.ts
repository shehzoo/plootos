// Spec 1.4, cases A and B, and the rules R3 and R4 around them.

import { describe, expect, it } from 'vitest'
import {
  Ledger,
  archiveLine,
  modifyLine,
  type BudgetData,
  type Id,
  type LineChange,
  type NewVersion,
} from '../src/engine'
import { CAT, LINE, SECTION, euros, exampleData, versionId } from './fixtures'

const NOW = '2027-05-10T08:00:00Z'

/** Writes a change the way the Worker will (lot 3), on a copy of the data. */
function apply(data: BudgetData, lineId: Id, change: LineChange, newVersion?: NewVersion): BudgetData {
  const next = structuredClone(data)
  for (const { id, endMonth } of change.endVersions) {
    const v = next.versions.find((x) => x.id === id)
    if (v) v.endMonth = endMonth
  }
  for (const v of next.versions) if (change.replaceVersionIds.includes(v.id)) v.replacedAt = NOW
  for (const o of next.overrides) if (change.removedOverrideIds.includes(o.id)) o.removedAt = NOW
  if (newVersion) {
    next.versions.push({ id: Math.max(...next.versions.map((v) => v.id)) + 1, budgetLineId: lineId, replacedAt: null, ...newVersion })
  }
  return next
}

const lineVersions = (data: BudgetData, lineId: Id) => data.versions.filter((v) => v.budgetLineId === lineId)
const lineOverrides = (data: BudgetData, lineId: Id) => data.overrides.filter((o) => o.budgetLineId === lineId)
const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)

describe('case A: quarterly line changed during the year (R3, C1)', () => {
  const base = exampleData()
  base.overrides.push(
    { id: 401, budgetLineId: LINE.insuranceCar, month: '2027-07', amountCents: euros(250), reason: null, removedAt: null },
    { id: 402, budgetLineId: LINE.insuranceCar, month: '2027-10', amountCents: euros(300), reason: null, removedAt: null },
  )
  const result = modifyLine({
    versions: lineVersions(base, LINE.insuranceCar),
    overrides: lineOverrides(base, LINE.insuranceCar),
    fromMonth: '2027-06',
    currentMonth: '2027-05',
    categoryId: CAT.insuranceCar,
    amountCents: euros(270),
    rhythm: { kind: 'every_n', everyN: 2 },
  })
  if (!result.ok) throw new Error(result.error)
  const change = result.value

  it('ends the running version in May and starts a new one in June, anchor kept', () => {
    expect(change.endVersions).toEqual([{ id: versionId(LINE.insuranceCar), endMonth: '2027-05' }])
    expect(change.replaceVersionIds).toEqual([])
    expect(change.newVersion).toEqual({
      categoryId: CAT.insuranceCar,
      amountCents: euros(270),
      startMonth: '2027-06',
      endMonth: null,
      rhythm: { kind: 'every_n', everyN: 2, anchorMonth: '2027-01' },
    })
  })

  it('shows July, September, November 2027, then January 2028', () => {
    expect(change.previewMonths.slice(0, 4)).toEqual(['2027-07', '2027-09', '2027-11', '2028-01'])
  })

  it('keeps the July override and removes the October one', () => {
    expect(change.keptOverrideIds).toEqual([401])
    expect(change.removedOverrideIds).toEqual([402])
  })

  it('plans 1,270 € for Assurance > Auto in 2027', () => {
    const ledger = new Ledger(apply(base, LINE.insuranceCar, change, change.newVersion))
    const planned = monthsOf(2027).map((m) => Math.abs(ledger.planned(CAT.insuranceCar, m)) / 100)
    expect(planned).toEqual([240, 0, 0, 240, 0, 0, 250, 0, 270, 0, 270, 0])
    expect(planned.reduce((a, b) => a + b, 0)).toBe(1270)
  })
})

describe('case B: archived line (R4, off budget)', () => {
  const base = exampleData({ enteredUpTo: '2027-03-31' })
  base.overrides.push({ id: 403, budgetLineId: LINE.energy, month: '2027-06', amountCents: euros(200), reason: null, removedAt: null })
  base.operations.push({
    id: 60, opDate: '2027-05-15', valueDate: '2027-05-15', amountCents: euros(-150), origin: 'manual',
    bankLabel: null, bankLabelRaw: null, dupRank: null, comment: null, archivedAt: null,
  })
  base.parts.push({ id: 600, operationId: 60, categoryId: CAT.energy, amountCents: euros(-150) })

  const result = archiveLine({
    versions: lineVersions(base, LINE.energy),
    overrides: lineOverrides(base, LINE.energy),
    lastMonth: '2027-04',
    currentMonth: '2027-05',
  })
  if (!result.ok) throw new Error(result.error)
  const ledger = new Ledger(apply(base, LINE.energy, result.value))

  it('ends the version in April and removes the June override', () => {
    expect(result.value.endVersions).toEqual([{ id: versionId(LINE.energy), endMonth: '2027-04' }])
    expect(result.value.removedOverrideIds).toEqual([403])
  })

  it('plans Énergie in April only', () => {
    expect(ledger.planned(CAT.energy, '2027-04')).toBe(euros(-150))
    expect(ledger.planned(CAT.energy, '2027-05')).toBe(0)
    expect(ledger.planned(CAT.energy, '2027-06')).toBe(0)
  })

  it('reads Énergie off budget in May, with no remainder', () => {
    expect(ledger.status(CAT.energy, '2027-05')).toBe('off_budget')
    expect(ledger.actual(CAT.energy, '2027-05')).toBe(euros(-150))
    expect(ledger.remaining(CAT.energy, '2027-05')).toBeNull()
    expect(ledger.sectionRemaining(SECTION.fixed, '2027-05').offBudgetActualCents).toBe(euros(-150))
  })

  it('plans +2,260 € for May 2027, all categories', () => {
    expect(ledger.plannedNet('2027-05')).toBe(euros(2260))
  })
})

describe('R3 rules', () => {
  const data = exampleData()
  const base = {
    versions: lineVersions(data, LINE.groceries),
    overrides: lineOverrides(data, LINE.groceries),
    categoryId: CAT.groceries,
    amountCents: euros(850),
    rhythm: { kind: 'every_n' as const, everyN: 1 },
  }

  it('refuses a month before the current one', () => {
    expect(modifyLine({ ...base, fromMonth: '2027-02', currentMonth: '2027-03' })).toEqual({ ok: false, error: 'FROM_MONTH_IN_PAST' })
  })

  it('refuses an amount that is not positive, and a rhythm that is not valid', () => {
    expect(modifyLine({ ...base, fromMonth: '2027-04', currentMonth: '2027-03', amountCents: 0 })).toMatchObject({ error: 'AMOUNT_NOT_POSITIVE' })
    expect(modifyLine({ ...base, fromMonth: '2027-04', currentMonth: '2027-03', rhythm: { kind: 'every_n', everyN: 0 } })).toMatchObject({ error: 'INVALID_RHYTHM' })
    expect(modifyLine({ ...base, fromMonth: '2027-04', currentMonth: '2027-03', rhythm: { kind: 'months', months: [] } })).toMatchObject({ error: 'INVALID_RHYTHM' })
  })

  it('replaces a version that starts on the chosen month or later', () => {
    const later = structuredClone(data)
    later.versions.find((v) => v.id === versionId(LINE.groceries))!.endMonth = '2027-05'
    later.versions.push({ ...later.versions.find((v) => v.id === versionId(LINE.groceries))!, id: 900, startMonth: '2027-06', endMonth: null, amountCents: euros(900) })
    const r = modifyLine({ ...base, versions: lineVersions(later, LINE.groceries), fromMonth: '2027-04', currentMonth: '2027-03' })
    if (!r.ok) throw new Error(r.error)
    expect(r.value.endVersions).toEqual([{ id: versionId(LINE.groceries), endMonth: '2027-03' }])
    expect(r.value.replaceVersionIds).toEqual([900])
  })

  it('keeps the future last month of an archived line', () => {
    const archived = structuredClone(data)
    archived.versions.find((v) => v.id === versionId(LINE.groceries))!.endMonth = '2027-08'
    const r = modifyLine({ ...base, versions: lineVersions(archived, LINE.groceries), fromMonth: '2027-04', currentMonth: '2027-03' })
    if (!r.ok) throw new Error(r.error)
    expect(r.value.newVersion.endMonth).toBe('2027-08')
    expect(modifyLine({ ...base, versions: lineVersions(archived, LINE.groceries), fromMonth: '2027-09', currentMonth: '2027-03' })).toMatchObject({ error: 'LINE_ENDED' })
  })

  it('anchors on the chosen month when ticked months become "every N months"', () => {
    const r = modifyLine({
      versions: lineVersions(data, LINE.childcare),
      overrides: [],
      fromMonth: '2027-04',
      currentMonth: '2027-03',
      categoryId: CAT.childcare,
      amountCents: euros(400),
      rhythm: { kind: 'every_n', everyN: 2 },
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.value.newVersion.rhythm).toEqual({ kind: 'every_n', everyN: 2, anchorMonth: '2027-04' })
  })

  it('takes a new anchor when the change sets one', () => {
    const r = modifyLine({ ...base, fromMonth: '2027-04', currentMonth: '2027-03', rhythm: { kind: 'every_n', everyN: 3, anchorMonth: '2027-05' } })
    if (!r.ok) throw new Error(r.error)
    expect(r.value.previewMonths.slice(0, 3)).toEqual(['2027-05', '2027-08', '2027-11'])
  })

  it('removes an override when the line no longer applies that month', () => {
    const withOverride = structuredClone(data)
    withOverride.overrides.push({ id: 404, budgetLineId: LINE.groceries, month: '2027-05', amountCents: euros(1000), reason: null, removedAt: null })
    const r = modifyLine({
      ...base,
      overrides: lineOverrides(withOverride, LINE.groceries),
      fromMonth: '2027-04',
      currentMonth: '2027-03',
      rhythm: { kind: 'months', months: [4, 6] },
    })
    if (!r.ok) throw new Error(r.error)
    // The March override is before the change: neither kept nor removed.
    expect(r.value.keptOverrideIds).toEqual([])
    expect(r.value.removedOverrideIds).toEqual([404])
  })

  it('leaves the planned of past months unchanged', () => {
    const r = modifyLine({ ...base, fromMonth: '2027-04', currentMonth: '2027-04' })
    if (!r.ok) throw new Error(r.error)
    const ledger = new Ledger(apply(data, LINE.groceries, r.value, r.value.newVersion))
    expect(ledger.planned(CAT.groceries, '2027-03')).toBe(euros(-990))
    expect(ledger.planned(CAT.groceries, '2027-04')).toBe(euros(-890))
  })
})

describe('R4 rules', () => {
  const data = exampleData()
  const versions = lineVersions(data, LINE.groceries)

  it('accepts the month before the current one at the earliest', () => {
    expect(archiveLine({ versions, overrides: [], lastMonth: '2027-03', currentMonth: '2027-04' }).ok).toBe(true)
    expect(archiveLine({ versions, overrides: [], lastMonth: '2027-02', currentMonth: '2027-04' })).toEqual({ ok: false, error: 'LAST_MONTH_TOO_EARLY' })
  })

  it('only brings the last month of an archived line earlier', () => {
    const archived = structuredClone(data)
    archived.versions.find((v) => v.id === versionId(LINE.groceries))!.endMonth = '2027-08'
    const v = lineVersions(archived, LINE.groceries)
    expect(archiveLine({ versions: v, overrides: [], lastMonth: '2027-09', currentMonth: '2027-04' })).toMatchObject({ error: 'LINE_ENDED' })
    expect(archiveLine({ versions: v, overrides: [], lastMonth: '2027-06', currentMonth: '2027-04' })).toMatchObject({
      ok: true,
      value: { endVersions: [{ id: versionId(LINE.groceries), endMonth: '2027-06' }] },
    })
  })

  it('replaces the versions that start after the last month', () => {
    const later = structuredClone(data)
    later.versions.find((v) => v.id === versionId(LINE.groceries))!.endMonth = '2027-05'
    later.versions.push({ ...later.versions.find((v) => v.id === versionId(LINE.groceries))!, id: 901, startMonth: '2027-06', endMonth: null })
    const r = archiveLine({ versions: lineVersions(later, LINE.groceries), overrides: [], lastMonth: '2027-04', currentMonth: '2027-04' })
    expect(r).toEqual({
      ok: true,
      value: {
        endVersions: [{ id: versionId(LINE.groceries), endMonth: '2027-04' }],
        replaceVersionIds: [901],
        keptOverrideIds: [],
        removedOverrideIds: [],
      },
    })
  })
})
