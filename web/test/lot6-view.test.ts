// Screens 3.5, 3.2 and 3.6 on the example month (spec 1.3, 1.4): the figures they show.
// Data sets: "exemple" on 01/04 (projection of the spec), "exemple-15-03" on the evening of 15/03.

import { describe, expect, it } from 'vitest'
import { CAT, exampleSeedInput, LINE } from '../../shared/fixtures/example'
import { seedResponse, toSeed } from '../../shared/fixtures/seed'
import { Ledger, type IsoDate } from '../../shared/src/engine'
import { budgetData, decodeData } from '../../shared/src/wire'
import { signedPlainEuros, plainEuros } from '../src/format'
import {
  budgetBounds,
  budgetView,
  clampBudgetMonth,
  lineRecord,
  versionRhythmText,
  yearMonths,
} from '../src/budget/view'
import type { MonthContext } from '../src/month/view'
import {
  clampOperationsMonth,
  operationDetail,
  operationsBounds,
  operationsView,
} from '../src/operations/view'
import { approximateText, chartGeometry, projectionView } from '../src/projection/view'
import { budgetPath, operationsPath, placeFromLocation } from '../src/router'

const AUTHORS = ['p1@example.test', 'p2@example.test'] as const
const USERS = new Map([
  ['p1@example.test', 'Personne 1'],
  ['p2@example.test', 'Personne 2'],
])

function context(today: IsoDate, enteredUpTo?: IsoDate): MonthContext {
  const seed = toSeed(exampleSeedInput(enteredUpTo ? { enteredUpTo } : {}), AUTHORS)
  const app = decodeData(seedResponse(seed, USERS, today))
  return { ledger: new Ledger(budgetData(app)!), app, today }
}

describe('projection (3.5)', () => {
  const ctx = context('2027-04-01')
  const view = projectionView(ctx)

  it('April and May of the spec, from the app balance of 01/04', () => {
    const [april, may] = view.rows
    expect(april).toEqual({ month: '2027-04', plannedCents: 187000, endBalanceCents: 686800 })
    expect(may).toEqual({ month: '2027-05', plannedCents: 211000, endBalanceCents: 897800 })
    expect(view.current).toBe('2027-04')
    expect(view.rows[view.rows.length - 1]?.month).toBe('2030-12')
  })

  it('groups the months by year; a folded year shows its December balance', () => {
    expect(view.years.map((y) => y.year)).toEqual(['2027', '2028', '2029', '2030'])
    expect(view.years[0]?.rows).toHaveLength(9)
    expect(view.years[1]?.rows).toHaveLength(12)
    expect(view.years[0]?.endBalanceCents).toBe(view.rows.find((r) => r.month === '2027-12')?.endBalanceCents)
  })

  it('lowest point, and no "below zero" while the balance stays positive', () => {
    expect(view.belowZero).toBeNull()
    expect(view.low.cents).toBe(Math.min(...view.rows.map((r) => r.endBalanceCents)))
    expect(view.approximate).toBeNull()
  })

  it('on the evening of 15/03, March ends at 4,600 €', () => {
    const march = projectionView(context('2027-03-15', '2027-03-15'))
    expect(march.rows[0]).toMatchObject({ month: '2027-03', endBalanceCents: 460000 })
    expect(march.appBalanceCents).toBe(594500)
    expect(march.check).toEqual({ date: '2027-03-12', gapCents: 0, operationsSince: 2 })
  })

  it('finds the first month under zero', () => {
    const poor = context('2027-04-01')
    poor.ledger.data.openingBalance.amountCents = -3_000_000
    const v = projectionView({ ...poor, ledger: new Ledger(poor.ledger.data) })
    expect(v.belowZero).toBe('2027-04')
  })

  it('says how many operations make the figure approximate', () => {
    const text = approximateText({ count: 2, outCents: 3500, inCents: 2000 })
    expect(text).toMatch(/^Approximatif : 2\sopérations à catégoriser \(−35\s€, \+20\s€\)/)
  })
})

describe('curve', () => {
  const rows = projectionView(context('2027-04-01')).rows

  it('puts the points in order inside the frame, with a mark by year', () => {
    for (const narrow of [false, true]) {
      const g = chartGeometry(rows, narrow)
      expect(g.points).toHaveLength(rows.length)
      expect(g.points[0]?.x).toBe(g.left)
      expect(g.points[g.points.length - 1]?.x).toBe(g.width - g.right)
      for (const p of g.points) {
        expect(p.y).toBeGreaterThanOrEqual(g.top)
        expect(p.y).toBeLessThanOrEqual(g.height - g.bottom)
      }
      expect(g.years.map((y) => y.year)).toEqual(['2027', '2028', '2029', '2030'])
      expect(g.zeroY).toBeNull()
      expect(g.ticks.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('a phone gets a taller curve with fewer marks', () => {
    const wide = chartGeometry(rows, false)
    const phone = chartGeometry(rows, true)
    expect(phone.height).toBeGreaterThan(wide.height)
    expect(phone.ticks.length).toBeLessThanOrEqual(wide.ticks.length)
  })

  it('draws the 0 € line when the curve goes under it', () => {
    const g = chartGeometry(
      [
        { month: '2027-04', plannedCents: 0, endBalanceCents: 100000 },
        { month: '2027-05', plannedCents: 0, endBalanceCents: -50000 },
      ],
      false,
    )
    expect(g.zeroY).not.toBeNull()
    expect(g.zeroY).toBe(g.baseY)
    expect(g.ticks.some((t) => t.cents === 0)).toBe(true)
  })
})

describe('operations (3.2)', () => {
  const ctx = context('2027-04-01')

  it('March: twelve operations by value date, the 01/04 one is in April', () => {
    const bounds = operationsBounds(ctx)
    expect(bounds).toEqual({ first: '2027-03', current: '2027-04', last: '2027-04' })
    const march = operationsView(ctx, '2027-03')
    expect(march.rows).toHaveLength(12)
    expect((march.rows[0]?.valueDate ?? '') >= (march.rows[11]?.valueDate ?? '')).toBe(true)
    expect(march.laterCount).toBe(1)
    expect(march.uncategorizedCount).toBe(0)
    expect(operationsView(ctx, '2027-04').rows).toHaveLength(1)
    expect(operationsView(ctx, '2027-04').laterCount).toBe(0)
  })

  it('a split operation reads « Répartie (2) »; the others show their category', () => {
    const march = operationsView(ctx, '2027-03')
    const split = march.rows.find((r) => r.amountCents === -26000)!
    expect(split.categoryText).toBe('Répartie (2)')
    const rent = march.rows.find((r) => r.amountCents === -120000)!
    expect(rent.categoryText).toBe('Logement')
    const shop = march.rows.find((r) => r.amountCents === -21000)!
    expect(shop.categoryText).toBe('Courses > Supermarché')
  })

  it('the record of a split operation lists its parts, signed', () => {
    const march = operationsView(ctx, '2027-03')
    const id = march.rows.find((r) => r.amountCents === -26000)!.id
    const d = operationDetail(ctx, id)!
    expect(d.split).toBe(true)
    expect(d.parts.map((p) => [p.categoryText, p.amountCents])).toEqual(
      expect.arrayContaining([
        ['Courses > Supermarché', -21500],
        ['Courses > Chats', -4500],
      ]),
    )
    expect(d.origin.by).toMatch(/^Personne/)
    expect(operationDetail(ctx, 999999)).toBeNull()
  })

  it('stays inside the months followed', () => {
    const bounds = operationsBounds(ctx)
    expect(clampOperationsMonth(null, bounds)).toBe('2027-04')
    expect(clampOperationsMonth('2027-01', bounds)).toBe('2027-04')
    expect(clampOperationsMonth('2030-01', bounds)).toBe('2027-04')
    expect(clampOperationsMonth('2027-03', bounds)).toBe('2027-03')
  })
})

describe('budget lines (3.6)', () => {
  const ctx = context('2027-03-15', '2027-03-15')
  const bounds = budgetBounds(ctx)
  const year = budgetView(ctx, yearMonths('2027-03'), '2027-03')
  const lineOf = (id: number) => year.sections.flatMap((s) => s.lines).find((l) => l.id === id)!

  it('lists the twelve months of the year', () => {
    expect(year.months).toHaveLength(12)
    expect(year.months[0]).toBe('2027-01')
    expect(year.months[11]).toBe('2027-12')
    expect(clampBudgetMonth('2027-02', bounds)).toBe('2027-03')
  })

  it('Courses: 800 € every month, 950 € in bold in March', () => {
    const cells = lineOf(LINE.groceries).cells
    expect(cells[2]).toMatchObject({ month: '2027-03', amountCents: 95000, overridden: true })
    expect(cells[3]).toMatchObject({ month: '2027-04', amountCents: 80000, overridden: false })
  })

  it('Assurance > Auto: every 3 months from January (April, July, October followed), nothing in March', () => {
    const cells = lineOf(LINE.insuranceCar).cells
    expect(cells.map((c) => c.amountCents)).toEqual([null, null, null, 24000, null, null, 24000, null, null, 24000, null, null])
    expect(lineOf(LINE.insuranceCar).categoryPath).toBe('Assurance > Auto')
    expect(lineOf(LINE.insuranceCar).rhythm).toBe('Tous les 3 mois, calés sur janvier')
  })

  it('shows nothing before the first month followed (January and February)', () => {
    expect(lineOf(LINE.childcare).cells.slice(0, 2).map((c) => c.amountCents)).toEqual([null, null])
    expect(year.net.slice(0, 3)).toEqual([null, null, 160000])
    expect(year.sections.every((s) => s.totals[0] === 0 && s.totals[1] === 0)).toBe(true)
  })

  it('greys the months before the current one', () => {
    const cells = lineOf(LINE.housing).cells
    expect(cells.map((c) => c.past)).toEqual([true, true, false, false, false, false, false, false, false, false, false, false])
  })

  it('« Prévu du mois »: +1,600 € in March (spec 1.3), +1,870 € in April', () => {
    expect(year.net[2]).toBe(160000)
    expect(year.net[3]).toBe(187000)
    expect(signedPlainEuros(year.net[3] as number)).toMatch(/^\+1\s870$/)
    expect(signedPlainEuros(-9000)).toMatch(/^−90$/)
  })

  it('section totals are read as amounts (an expense reads positive)', () => {
    const fixed = year.sections.find((s) => s.name === 'Dépenses fixes')!
    // March: housing 1,200 + energy 150 + childcare 400 + home insurance 360
    expect(fixed.totals[2]).toBe(211000)
    expect(plainEuros(fixed.totals[2] as number)).toMatch(/^2\s110$/)
  })

  it('phone: one month, with the overrides still to come', () => {
    const march = budgetView(ctx, ['2027-03'], '2027-03')
    expect(march.net).toEqual([160000])
    const courses = march.sections.flatMap((s) => s.lines).find((l) => l.id === LINE.groceries)!
    expect(courses.cells).toHaveLength(1)
    expect(courses.upcomingOverrides).toBe(0)
    // Two overrides after March, one of them removed: only the other one is still to come.
    const stored = ctx.app.overrides[0]!
    const extra = [
      { ...stored, id: 9001, month: '2027-06', removedAt: null },
      { ...stored, id: 9002, month: '2027-07', removedAt: '2027-03-20T10:00:00Z' },
    ]
    const withMore = { ...ctx, app: { ...ctx.app, overrides: [...ctx.app.overrides, ...extra] } }
    const later = budgetView(withMore, ['2027-03'], '2027-03').sections.flatMap((s) => s.lines).find((l) => l.id === LINE.groceries)!
    expect(later.upcomingOverrides).toBe(1)
  })

  it('record of Courses: one version, one override with its reason and author', () => {
    const r = lineRecord(ctx, LINE.groceries)!
    expect(r.label).toBeTruthy()
    expect(r.amountCents).toBe(80000)
    expect(r.rhythm).toBe('Tous les mois')
    expect(r.versions).toHaveLength(1)
    expect(r.overrides).toEqual([
      expect.objectContaining({ month: '2027-03', amountCents: 95000, reason: 'Anniversaire', removed: false }),
    ])
    expect(r.overrides[0]?.by).toMatch(/^Personne/)
    expect(lineRecord(ctx, 424242)).toBeNull()
  })

  it('writes rhythms with their anchor', () => {
    expect(versionRhythmText({ kind: 'every_n', everyN: 12, anchorMonth: '2027-03' })).toBe('Tous les 12 mois, calés sur mars')
    expect(versionRhythmText({ kind: 'every_n', everyN: 1, anchorMonth: '2027-03' })).toBe('Tous les mois')
  })
})

describe('paths', () => {
  it('writes and reads the month and the open record', () => {
    expect(operationsPath(null)).toBe('/operations')
    expect(operationsPath('2027-03', 12)).toBe('/operations/2027-03?operation=12')
    expect(budgetPath(null, 104)).toBe('/budget?ligne=104')
    expect(budgetPath('2028-01')).toBe('/budget/2028-01')
    expect(placeFromLocation('/operations/2027-03', '?operation=12')).toMatchObject({
      section: 'operations',
      month: '2027-03',
      operationId: 12,
    })
    expect(placeFromLocation('/budget', '?ligne=104')).toMatchObject({ section: 'budget', month: null, lineId: 104 })
    expect(placeFromLocation('/mois/2027-05', '?categorie=3')).toMatchObject({ section: 'mois', month: '2027-05', categoryId: 3 })
    expect(placeFromLocation('/projection', '')).toMatchObject({ section: 'projection', month: null })
    expect(CAT.groceries).toBeGreaterThan(0)
  })
})
