// Screens 3.1 and 3.4 on the example month (spec 1.3): the figures the screens show, on the
// evening of 15/03 (data set "exemple-15-03") and on 01/04 (data set "exemple").

import { describe, expect, it } from 'vitest'
import { CAT, exampleSeedInput, SECTION } from '../../shared/fixtures/example'
import { seedResponse, toSeed } from '../../shared/fixtures/seed'
import { Ledger, type IsoDate } from '../../shared/src/engine'
import { budgetData, decodeData } from '../../shared/src/wire'
import { euros, eurosOrMinus, monthTitle, signedEuros } from '../src/format'
import {
  band,
  clampMonth,
  detail,
  gapText,
  kindOf,
  monthBounds,
  monthGapText,
  remainderText,
  rhythmText,
  sections,
  type MonthContext,
  type SectionView,
} from '../src/month/view'

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

const NNBSP = ' '
const NBSP = ' '
const e = (text: string) => text.replace(/(\d) (?=\d{3})/g, `$1${NNBSP}`).replace(/ €/g, `${NBSP}€`)

const section = (list: SectionView[], id: number) => list.find((s) => s.id === id)!
const rowOf = (list: SectionView[], sectionId: number, id: number) => section(list, sectionId).rows.find((r) => r.id === id)!

describe('format', () => {
  it('writes euros as the design system says', () => {
    expect(euros(123456700)).toBe(e('1 234 567 €'))
    expect(euros(4250)).toBe(e('42,50 €'))
    expect(euros(-21000)).toBe(e('210 €'))
    expect(eurosOrMinus(-1500)).toBe(e('−15 €'))
    expect(signedEuros(2000)).toBe(e('+20 €'))
    expect(signedEuros(-26000)).toBe(e('−260 €'))
    expect(signedEuros(0)).toBe(e('0 €'))
    expect(monthTitle('2027-03')).toBe('Mars 2027')
  })

  it('writes gaps and remainders in words', () => {
    expect(gapText({ cents: -42500, bad: false }, 'out')).toBe(e('425 € dépensés en moins'))
    expect(gapText({ cents: 150, bad: true }, 'out')).toBe(e('1,50 € dépensé en plus'))
    expect(gapText({ cents: -20000, bad: true }, 'in')).toBe(e('200 € reçus en moins'))
    expect(gapText({ cents: 0, bad: false }, 'out')).toBe('')
    expect(monthGapText(39800)).toBe(e('398 € de mieux'))
    expect(monthGapText(-4000)).toBe(e('40 € de moins'))
    expect(remainderText({ kind: 'over', cents: 1200 })).toBe(e('dépassé de 12 €'))
    expect(remainderText({ kind: 'extra', cents: 5000 })).toBe(e('reçu en plus 50 €'))
  })

  it('describes rhythms', () => {
    expect(rhythmText({ kind: 'every_n', everyN: 1, anchorMonth: '2027-03' })).toBe('Tous les mois')
    expect(rhythmText({ kind: 'every_n', everyN: 3, anchorMonth: '2027-01' })).toBe('Tous les 3 mois')
    expect(rhythmText({ kind: 'months', months: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6] })).toBe(
      'Mois cochés : janvier à juin, septembre à décembre',
    )
  })
})

describe('months reached by the arrows', () => {
  const ctx = context('2027-03-15', '2027-03-15')
  const bounds = monthBounds(ctx)

  it('from the first month followed to December N+3', () => {
    expect(bounds).toEqual({ first: '2027-03', current: '2027-03', last: '2030-12' })
    expect(kindOf('2027-04', bounds)).toBe('future')
    expect(clampMonth('2027-02', bounds)).toBe('2027-03')
    expect(clampMonth('2031-01', bounds)).toBe('2027-03')
    expect(clampMonth('2028-06', bounds)).toBe('2028-06')
  })

  it('a past month opens the closed month', () => {
    expect(kindOf('2027-03', monthBounds(context('2027-04-01')))).toBe('closed')
  })
})

describe('current month on the evening of 15/03 (spec 1.3, U5)', () => {
  const ctx = context('2027-03-15', '2027-03-15')
  const bounds = monthBounds(ctx)
  const list = sections(ctx, '2027-03', 'current')

  it('band: app balance 5,945 €, projected 4,600 €, last check', () => {
    expect(band(ctx, '2027-03', 'current', bounds)).toEqual({
      kind: 'current',
      appBalanceCents: 594500,
      check: { date: '2027-03-12', gapCents: 0, operationsSince: 2 },
      projectedCents: 460000,
      approximate: false,
      monthUncategorizedCount: 0,
      monthUncategorizedCents: 0,
      remainingOutCents: 68500 + 36000 + 30000,
      remainingInCents: 0,
      uncategorizedCount: 0,
    })
  })

  it('Courses: planned 990 €, actual 305 €, remainder 685 €; Chats 40 €', () => {
    const courses = rowOf(list, SECTION.everyday, CAT.groceries)
    expect(courses).toMatchObject({ plannedCents: 99000, actualCents: 30500, remainder: { kind: 'amount', cents: 68500 } })
    expect(courses.progress?.ratio).toBeCloseTo(305 / 990)
    const cats = courses.children.find((c) => c.id === CAT.cats)!
    expect(cats).toMatchObject({ status: 'budgeted', plannedCents: 4000, actualCents: 0, remainder: { kind: 'amount', cents: 4000 }, progress: null })
    const supermarket = courses.children.find((c) => c.id === CAT.supermarket)!
    expect(supermarket).toMatchObject({ status: 'within', withinName: 'Courses', actualCents: 21000, remainder: { kind: 'none' } })
    expect(courses.children.map((c) => c.id)).toEqual([CAT.supermarket, CAT.butcher, CAT.cats])
  })

  it('Assurance 360 €, Livret A 300 €, the other budgeted categories settled', () => {
    expect(rowOf(list, SECTION.fixed, CAT.insurance).remainder).toEqual({ kind: 'amount', cents: 36000 })
    expect(rowOf(list, SECTION.savings, CAT.savingsAccount).remainder).toEqual({ kind: 'amount', cents: 30000 })
    for (const [s, c] of [
      [SECTION.regularIncome, CAT.salaries],
      [SECTION.fixed, CAT.housing],
      [SECTION.fixed, CAT.energy],
      [SECTION.fixed, CAT.childcare],
    ] as const) {
      const r = rowOf(list, s, c)
      expect(r.remainder).toEqual({ kind: 'settled' })
      expect(r.progress).toBeNull()
    }
  })

  it('hides what has neither line nor operation this month', () => {
    expect(list.map((s) => s.id)).toEqual([SECTION.regularIncome, SECTION.fixed, SECTION.everyday, SECTION.savings])
    // Santé: no line, no operation yet. Assurance > Auto: no line in March, no operation.
    expect(section(list, SECTION.everyday).rows.map((r) => r.id)).toEqual([CAT.groceries])
    expect(rowOf(list, SECTION.fixed, CAT.insurance).children.map((c) => c.id)).toEqual([CAT.insuranceHome])
  })

  it('section remainders (C10)', () => {
    expect(section(list, SECTION.everyday).summary).toEqual([{ text: e('reste 685 €'), over: false }])
    expect(section(list, SECTION.fixed).summary).toEqual([{ text: e('reste 360 €'), over: false }])
    expect(section(list, SECTION.regularIncome).summary).toEqual([{ text: 'soldé', over: false }])
    expect(section(list, SECTION.fixed).plannedCents).toBe(211000)
  })

  it('detail of Courses: its lines, the override, its operations', () => {
    const d = detail(ctx, '2027-03', 'current', CAT.groceries)!
    expect(d.context).toBe('Dépenses courantes')
    expect(d.lines).toEqual([
      { budgetLineId: 104, label: 'Courses', amountCents: 95000, caption: e('Surchargée en mars, au lieu de 800 € ; motif : Anniversaire ; par Personne 2') },
      { budgetLineId: 105, label: 'Chats', amountCents: 4000, caption: 'Courses > Chats · Tous les mois' },
    ])
    expect(d.operations?.map((o) => [o.valueDate, o.amountCents, o.caption])).toEqual([
      ['2027-03-12', -9500, 'Boucherie'],
      ['2027-03-06', -21000, 'Supermarché'],
    ])
    expect(d.children.map((c) => c.id)).toEqual([CAT.supermarket, CAT.butcher, CAT.cats])
  })

  it('detail of a subcategory counted in its category', () => {
    const d = detail(ctx, '2027-03', 'current', CAT.supermarket)!
    expect(d.context).toBe('Dépenses courantes · Courses')
    expect(d.lines).toEqual([])
    expect(d.noLines).toBe('Comptée dans Courses.')
    expect(detail(ctx, '2027-03', 'current', CAT.insuranceCar)).toBeNull()
  })

  it('a future month: the planned only', () => {
    const april = sections(ctx, '2027-04', 'future')
    expect(rowOf(april, SECTION.fixed, CAT.insurance)).toMatchObject({ plannedCents: 24000, actualCents: 0, progress: null })
    expect(rowOf(april, SECTION.everyday, CAT.groceries).plannedCents).toBe(84000)
    expect(detail(ctx, '2027-04', 'future', CAT.groceries)?.operations).toBeNull()
  })
})

describe('on 01/04: March closed, April current (spec 1.3, U6, U7)', () => {
  const ctx = context('2027-04-01')
  const bounds = monthBounds(ctx)
  const march = sections(ctx, '2027-03', 'closed')

  it('band of March: 4,998 € real, 4,600 € at budget, 398 € better', () => {
    expect(band(ctx, '2027-03', 'closed', bounds)).toEqual({
      kind: 'closed',
      endBalanceCents: 499800,
      plannedEndBalanceCents: 460000,
      gapCents: 39800,
      // The check of 02/04 is after "today".
      check: null,
      monthUncategorizedCount: 0,
    })
  })

  it('gaps by category (C6)', () => {
    const expected: [number, number, number, number, number][] = [
      [SECTION.regularIncome, CAT.salaries, 500000, 500000, 0],
      [SECTION.fixed, CAT.housing, 120000, 120000, 0],
      [SECTION.everyday, CAT.groceries, 99000, 56500, -42500],
      [SECTION.fixed, CAT.energy, 15000, 15000, 0],
      [SECTION.fixed, CAT.childcare, 40000, 40000, 0],
      [SECTION.fixed, CAT.insurance, 36000, 37200, 1200],
      [SECTION.savings, CAT.savingsAccount, 30000, 30000, 0],
      [SECTION.everyday, CAT.health, 0, 1500, 1500],
    ]
    for (const [s, c, planned, actual, gap] of expected) {
      const r = rowOf(march, s, c)
      expect([r.plannedCents, r.actualCents, r.gap?.cents]).toEqual([planned, actual, gap])
    }
    const courses = rowOf(march, SECTION.everyday, CAT.groceries)
    expect(gapText(courses.gap, 'out')).toBe(e('425 € dépensés en moins'))
    const cats = courses.children.find((c) => c.id === CAT.cats)!
    expect([cats.plannedCents, cats.actualCents, cats.gap]).toEqual([4000, 4500, { cents: 500, bad: true }])
    expect(courses.subOverruns).toEqual([{ name: 'Chats', text: e('5 € dépensés en plus') }])
    expect(rowOf(march, SECTION.everyday, CAT.health).status).toBe('off_budget')
  })

  it('section gaps (C11), overruns, off budget', () => {
    expect(section(march, SECTION.everyday).summary).toEqual([
      { text: e('410 € dépensés en moins'), over: false },
      { text: e('1 dépassement (5 €)'), over: true },
      { text: e('hors budget 15 €'), over: false },
    ])
    expect(section(march, SECTION.fixed).summary).toEqual([
      { text: e('12 € dépensés en plus'), over: false },
      { text: e('1 dépassement (12 €)'), over: true },
    ])
    expect(section(march, SECTION.regularIncome).summary).toEqual([])
  })

  it('balance of the month: +1,600 € planned, +1,998 € actual', () => {
    expect(ctx.ledger.plannedNet('2027-03')).toBe(160000)
    expect(ctx.ledger.monthSummary('2027-03').actualNetCents).toBe(199800)
  })

  it('detail of Courses in March: the split operation', () => {
    const d = detail(ctx, '2027-03', 'closed', CAT.groceries)!
    const split = d.operations?.find((o) => o.valueDate === '2027-03-20')
    expect(split).toMatchObject({ amountCents: -26000, caption: e('Répartie : 215 € Supermarché, 45 € Chats') })
    // The purchase of 31/03 counts in April (value date 01/04).
    expect(d.operations?.some((o) => o.valueDate === '2027-04-01')).toBe(false)
  })

  it('April, current month: projected 6,868 € (spec 1.3, projection)', () => {
    const april = band(ctx, '2027-04', 'current', bounds)
    expect(april).toMatchObject({ kind: 'current', appBalanceCents: 476800, projectedCents: 686800, approximate: false })
  })

  it('May, future month: 8,978 € at the end, +2,110 € planned', () => {
    expect(band(ctx, '2027-05', 'future', bounds)).toEqual({ kind: 'future', projectedCents: 897800, plannedNetCents: 211000 })
  })
})

describe('operations to categorize', () => {
  it('make the projected balance approximate, and show in the closed month', () => {
    const ctx = context('2027-03-15', '2027-03-15')
    // Person 2's manual entry of 14/03, not yet categorized.
    ctx.app.operations.push({
      id: 99,
      opDate: '2027-03-14',
      valueDate: '2027-03-14',
      amountCents: -8400,
      origin: 'manual',
      bankLabel: null,
      bankLabelRaw: null,
      dupRank: null,
      comment: null,
      archivedAt: null,
      rowVersion: 1,
      createdBy: 'Personne 2',
      createdAt: '2027-03-14T18:00:00.000Z',
      updatedBy: 'Personne 2',
      updatedAt: '2027-03-14T18:00:00.000Z',
    })
    ctx.app.parts.push({
      id: 990,
      operationId: 99,
      categoryId: null,
      amountCents: -8400,
      rowVersion: 1,
      createdBy: 'Personne 2',
      createdAt: '2027-03-14T18:00:00.000Z',
      updatedBy: 'Personne 2',
      updatedAt: '2027-03-14T18:00:00.000Z',
    })
    const withEntry = { ...ctx, ledger: new Ledger(budgetData(ctx.app)!) }
    const current = band(withEntry, '2027-03', 'current', monthBounds(withEntry))
    expect(current).toMatchObject({
      appBalanceCents: 594500 - 8400,
      projectedCents: 460000 - 8400,
      approximate: true,
      monthUncategorizedCount: 1,
      monthUncategorizedCents: -8400,
      uncategorizedCount: 1,
    })
    const later = { ...withEntry, today: '2027-04-01' }
    expect(band(later, '2027-03', 'closed', monthBounds(later))).toMatchObject({ monthUncategorizedCount: 1 })
  })
})
