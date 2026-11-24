// Spec 1.3: the example month of March 2027 must give exactly the expected results.

import { describe, expect, it } from 'vitest'
import { Ledger } from '../src/engine'
import { CAT, SECTION, euros, exampleData } from './fixtures'

const MARCH = '2027-03'

describe('fixture', () => {
  it('splits each operation into parts that add up to its amount', () => {
    const data = exampleData()
    expect(data.operations).toHaveLength(13)
    for (const o of data.operations) {
      const total = data.parts.filter((p) => p.operationId === o.id).reduce((s, p) => s + p.amountCents, 0)
      expect(total).toBe(o.amountCents)
    }
  })
})

describe('closed month, March 2027 (U6, C3, C4, C6, C11)', () => {
  const ledger = new Ledger(exampleData())

  it.each([
    ['Salaires', CAT.salaries, 5000, 5000, 0],
    ['Logement', CAT.housing, -1200, -1200, 0],
    ['Courses', CAT.groceries, -990, -565, -425],
    ['Courses > Chats', CAT.cats, -40, -45, 5],
    ['Énergie', CAT.energy, -150, -150, 0],
    ['Garde des enfants', CAT.childcare, -400, -400, 0],
    ['Assurance', CAT.insurance, -360, -372, 12],
    ['Livret A', CAT.savingsAccount, -300, -300, 0],
    ['Santé', CAT.health, 0, -15, 15],
  ])('%s: planned, actual, gap', (_name, id, planned, actual, gap) => {
    expect(ledger.planned(id, MARCH)).toBe(euros(planned))
    expect(ledger.actual(id, MARCH)).toBe(euros(actual))
    expect(ledger.gap(id, MARCH)).toBe(euros(gap))
  })

  it('month totals and balances', () => {
    expect(ledger.monthSummary(MARCH)).toEqual({
      plannedNetCents: euros(1600),
      actualNetCents: euros(1998),
      gapCents: euros(398),
      startBalanceCents: euros(3000),
      plannedEndBalanceCents: euros(4600),
      actualEndBalanceCents: euros(4998),
    })
  })

  it('section gaps add up the gaps of their level-1 categories', () => {
    expect(ledger.sectionGap(SECTION.everyday, MARCH)).toBe(euros(-425 + 15))
    expect(ledger.sectionGap(SECTION.fixed, MARCH)).toBe(euros(12))
    expect(ledger.sectionGap(SECTION.regularIncome, MARCH)).toBe(0)
  })

  it('reads Santé as off budget, Supermarché within Courses, Auto within Assurance', () => {
    expect(ledger.status(CAT.health, MARCH)).toBe('off_budget')
    expect(ledger.status(CAT.pharmacy, MARCH)).toBe('off_budget')
    expect(ledger.status(CAT.supermarket, MARCH)).toBe('within')
    expect(ledger.status(CAT.insuranceCar, MARCH)).toBe('within')
    expect(ledger.status(CAT.cats, MARCH)).toBe('budgeted')
    expect(ledger.remaining(CAT.health, MARCH)).toBeNull()
  })

  it('app balance on 31/03 equals the bank balance (U8, C7)', () => {
    expect(ledger.balanceAt('2027-03-31')).toBe(euros(4998))
    expect(ledger.balanceAt('2027-02-28')).toBe(euros(3000))
    expect(ledger.balanceAt('2027-04-02')).toBe(euros(4768))
  })
})

describe('current month on the evening of 15/03 (U5, C5, C8, C10)', () => {
  const ledger = new Ledger(exampleData({ enteredUpTo: '2027-03-15' }))

  it('app balance is 5,945 €', () => {
    expect(ledger.balanceAt('2027-03-15')).toBe(euros(5945))
  })

  it('remainders', () => {
    expect(ledger.planned(CAT.groceries, MARCH)).toBe(euros(-990))
    expect(ledger.actual(CAT.groceries, MARCH)).toBe(euros(-305))
    expect(ledger.remaining(CAT.groceries, MARCH)).toBe(euros(685))
    expect(ledger.remaining(CAT.cats, MARCH)).toBe(euros(40))
    expect(ledger.remaining(CAT.insurance, MARCH)).toBe(euros(360))
    expect(ledger.remaining(CAT.savingsAccount, MARCH)).toBe(euros(300))
    for (const id of [CAT.salaries, CAT.housing, CAT.energy, CAT.childcare]) {
      expect(ledger.remaining(id, MARCH)).toBe(0)
    }
  })

  it('projected balance on 31/03 is 4,600 €, not approximate', () => {
    expect(ledger.currentMonthEnd(MARCH)).toEqual({
      amountCents: euros(4600),
      approximate: false,
      uncategorizedCount: 0,
      uncategorizedCents: 0,
    })
  })

  it('section remainders', () => {
    expect(ledger.sectionRemaining(SECTION.everyday, MARCH)).toEqual({
      remainingCents: euros(685),
      overrunCount: 0,
      overrunCents: 0,
      extraReceivedCents: 0,
      offBudgetActualCents: 0,
    })
    expect(ledger.sectionRemaining(SECTION.fixed, MARCH).remainingCents).toBe(euros(360))
    expect(ledger.sectionRemaining(SECTION.savings, MARCH).remainingCents).toBe(euros(300))
    expect(ledger.sectionRemaining(SECTION.regularIncome, MARCH).remainingCents).toBe(0)
  })
})

describe('current month on 31/03, every March operation entered (C10)', () => {
  const ledger = new Ledger(exampleData({ enteredUpTo: '2027-03-31' }))

  it('counts the overrun of a subcategory when its category is not overrun', () => {
    expect(ledger.sectionRemaining(SECTION.everyday, MARCH)).toEqual({
      remainingCents: euros(425),
      overrunCount: 1,
      overrunCents: euros(5),
      extraReceivedCents: 0,
      offBudgetActualCents: euros(-15),
    })
  })

  it('counts an overrun category once', () => {
    expect(ledger.sectionRemaining(SECTION.fixed, MARCH)).toMatchObject({
      remainingCents: 0,
      overrunCount: 1,
      overrunCents: euros(12),
    })
  })

  it('does not take an overrun off the projected balance twice (C8)', () => {
    // 4,998 € in the account, plus the 425 € still planned for Courses.
    expect(ledger.currentMonthEnd(MARCH).amountCents).toBe(euros(4998 - 425))
  })

  it('shows money received beyond the plan for an income section', () => {
    const data = exampleData({ enteredUpTo: '2027-03-31' })
    const salary = data.parts.find((p) => p.categoryId === CAT.salaryMary)
    if (!salary) throw new Error('fixture')
    data.operations.push({
      id: 99, opDate: '2027-03-30', valueDate: '2027-03-30', amountCents: euros(100), origin: 'manual',
      bankLabel: null, bankLabelRaw: null, dupRank: null, comment: null, archivedAt: null,
    })
    data.parts.push({ id: 990, operationId: 99, categoryId: CAT.salaryMary, amountCents: euros(100) })
    expect(new Ledger(data).sectionRemaining(SECTION.regularIncome, MARCH)).toMatchObject({
      remainingCents: 0,
      overrunCount: 0,
      extraReceivedCents: euros(100),
    })
  })
})

describe('override at 0 € (spec 2.1)', () => {
  it('keeps the line applying at 0 €: any spending that month is an overrun', () => {
    const data = exampleData({ enteredUpTo: '2027-03-31' })
    data.overrides.push({ id: 302, budgetLineId: 105, month: '2027-03', amountCents: 0, reason: null, removedAt: null })
    const ledger = new Ledger(data)
    expect(ledger.planned(CAT.cats, MARCH)).toBe(0)
    expect(ledger.status(CAT.cats, MARCH)).toBe('budgeted')
    expect(ledger.remaining(CAT.cats, MARCH)).toBe(euros(-45))
  })
})

describe('operations to categorize (C8 approximate)', () => {
  it('flags the projected balance with their count and amount', () => {
    const data = exampleData({ enteredUpTo: '2027-03-15' })
    data.operations.push({
      id: 50, opDate: '2027-03-14', valueDate: '2027-03-14', amountCents: euros(-60), origin: 'manual',
      bankLabel: null, bankLabelRaw: null, dupRank: null, comment: null, archivedAt: null,
    })
    data.parts.push({ id: 500, operationId: 50, categoryId: null, amountCents: euros(-60) })
    const ledger = new Ledger(data)
    // In the balance, not in the actual.
    expect(ledger.balanceAt('2027-03-15')).toBe(euros(5885))
    expect(ledger.actual(CAT.groceries, MARCH)).toBe(euros(-305))
    expect(ledger.currentMonthEnd(MARCH)).toEqual({
      amountCents: euros(4540),
      approximate: true,
      uncategorizedCount: 1,
      uncategorizedCents: euros(-60),
    })
  })

  it('ignores an archived manual operation everywhere', () => {
    const data = exampleData({ enteredUpTo: '2027-03-15' })
    data.operations.push({
      id: 51, opDate: '2027-03-14', valueDate: '2027-03-14', amountCents: euros(-60), origin: 'manual',
      bankLabel: null, bankLabelRaw: null, dupRank: null, comment: null, archivedAt: '2027-03-14T10:00:00Z',
    })
    data.parts.push({ id: 510, operationId: 51, categoryId: CAT.supermarket, amountCents: euros(-60) })
    const ledger = new Ledger(data)
    expect(ledger.balanceAt('2027-03-15')).toBe(euros(5945))
    expect(ledger.actual(CAT.groceries, MARCH)).toBe(euros(-305))
  })
})

describe('projection on 01/04, before any April operation is entered (U7, C9)', () => {
  // The operation valued 01/04 is not entered yet.
  const ledger = new Ledger(exampleData({ enteredUpTo: '2027-03-31' }))
  const rows = ledger.projection('2027-04')

  it('April and May', () => {
    expect(rows[0]).toEqual({ month: '2027-04', plannedCents: euros(1870), endBalanceCents: euros(6868) })
    expect(rows[1]).toEqual({ month: '2027-05', plannedCents: euros(2110), endBalanceCents: euros(8978) })
  })

  it('applies Assurance > Auto in April, and Courses without its March override', () => {
    expect(ledger.planned(CAT.insuranceCar, '2027-04')).toBe(euros(-240))
    expect(ledger.planned(CAT.groceries, '2027-04')).toBe(euros(-840))
  })

  it('runs to December of year N+3', () => {
    expect(rows.at(-1)?.month).toBe('2030-12')
    expect(rows).toHaveLength(9 + 36)
  })

  it('applies the childcare line on its ticked months only', () => {
    const months = rows.filter((r) => ledger.planned(CAT.childcare, r.month) !== 0).map((r) => r.month.slice(5))
    expect(new Set(months)).toEqual(new Set(['04', '05', '06', '09', '10', '11', '12', '01', '02', '03']))
  })
})
