// Lot 8: what the forms of screen 3.6 show before a write (R3, R4, overrides), on the example
// month and cases A and B of spec 1.4. The Worker applies the same pure functions
// (worker/test/lines.test.ts plays the same cases through the API).

import { describe, expect, it } from 'vitest'
import { CAT, LINE, casesABSeedInput, euros, exampleSeedInput } from '../../shared/fixtures/example'
import { seedResponse, toSeed, type SeedInput } from '../../shared/fixtures/seed'
import { Ledger, type IsoDate } from '../../shared/src/engine'
import { budgetData, decodeData } from '../../shared/src/wire'
import {
  anchorChoices,
  categoryChoices,
  changeRequest,
  defaultLastMonth,
  draftOf,
  draftState,
  editableLine,
  lastMonthChoices,
  monthsText,
  newLineRequest,
  newLineState,
  overrideTarget,
  previewArchive,
  previewChange,
  type EditableLine,
} from '../src/budget/lines'
import type { MonthContext } from '../src/month/view'
import { newLinePath, placeFromLocation } from '../src/router'

const AUTHORS = ['p1@example.test', 'p2@example.test'] as const
const USERS = new Map([
  ['p1@example.test', 'Personne 1'],
  ['p2@example.test', 'Personne 2'],
])

function context(today: IsoDate, input: SeedInput = exampleSeedInput(), extra?: (i: SeedInput) => void): MonthContext {
  extra?.(input)
  const app = decodeData(seedResponse(toSeed(input, AUTHORS), USERS, today))
  return { ledger: new Ledger(budgetData(app)!), app, today }
}

const withOverrides = (list: [number, string, number][]) => (i: SeedInput) => {
  list.forEach(([lineId, month, amount], k) =>
    i.data.overrides.push({ id: 900 + k, budgetLineId: lineId, month, amountCents: euros(amount), reason: null, removedAt: null }),
  )
}

describe('case A, as shown on 10 May 2027 (R3)', () => {
  const ctx = context('2027-05-10', exampleSeedInput(), withOverrides([[LINE.insuranceCar, '2027-07', 250], [LINE.insuranceCar, '2027-10', 300]]))
  const line = editableLine(ctx, LINE.insuranceCar) as EditableLine
  const draft = { ...draftOf(line), amount: '270', everyN: '2' }

  it('starts from the version in force, editable, from May at the earliest', () => {
    expect(line).toMatchObject({ editable: true, defaultFrom: '2027-05', endMonth: null })
    expect(draftOf(line)).toMatchObject({ amount: '240', kind: 'every_n', everyN: '3', categoryId: CAT.insuranceCar })
  })

  it('asks « à partir de » for a new amount and rhythm, not for a new name alone', () => {
    expect(draftState(line, draft)).toEqual({ renamed: false, changed: true, invalid: null })
    expect(draftState(line, { ...draftOf(line), label: 'Assurance voiture' })).toEqual({ renamed: true, changed: false, invalid: null })
  })

  it('from June: July, September and November 2027, then January 2028; July kept, October removed', () => {
    const out = previewChange(ctx, line, draft, '2027-06')
    if (!out.ok) throw new Error(out.error)
    expect(out.value.months).toBe('juillet, septembre et novembre 2027, puis janvier, mars et mai 2028…')
    expect(out.value.kept).toEqual([{ month: '2027-07', amountCents: euros(250) }])
    expect(out.value.removed).toEqual([{ month: '2027-10', amountCents: euros(300) }])
  })

  it('sends the change without an anchor: the anchor is kept (R3)', () => {
    expect(changeRequest(line, draft, '2027-06')).toEqual({
      fromMonth: '2027-06',
      categoryId: CAT.insuranceCar,
      amountCents: euros(270),
      rhythm: { kind: 'every_n', everyN: 2 },
    })
  })

  it('offers the first due month (calage): for 2 months from May, May or June, July kept means May', () => {
    expect(anchorChoices(line, 2)).toEqual({ months: ['2027-05', '2027-06'], kept: '2027-05' })
    const moved = { ...draft, anchor: '2027-06' }
    expect(draftState(line, moved).changed).toBe(true)
    expect(changeRequest(line, moved, '2027-06').rhythm).toEqual({ kind: 'every_n', everyN: 2, anchorMonth: '2027-06' })
    const out = previewChange(ctx, line, moved, '2027-06')
    if (!out.ok) throw new Error(out.error)
    expect(out.value.months.startsWith('juin, août')).toBe(true)
  })

  it('refuses a change from a past month', () => {
    expect(previewChange(ctx, line, draft, '2027-04')).toEqual({ ok: false, error: 'Le mois choisi est passé : une modification commence au plus tôt au mois en cours.' })
  })
})

describe('case B, as shown on 10 May 2027 (R4)', () => {
  const ctx = context('2027-05-10', casesABSeedInput(), withOverrides([[LINE.energy, '2027-06', 200]]))
  const line = editableLine(ctx, LINE.energy) as EditableLine

  it('offers April at the earliest, May by default', () => {
    expect(lastMonthChoices(ctx, line)[0]).toBe('2027-04')
    expect(defaultLastMonth(ctx, line)).toBe('2027-05')
  })

  it('April: no longer counts from May; the June override is removed', () => {
    const out = previewArchive(ctx, line, '2027-04')
    if (!out.ok) throw new Error(out.error)
    expect(out.value.from).toBe('2027-05')
    expect(out.value.removed).toEqual([{ month: '2027-06', amountCents: euros(200) }])
  })

  it('once archived in April, the line is read only', () => {
    const archived = context('2027-05-10', casesABSeedInput(), (i) => {
      const v = i.data.versions.find((x) => x.budgetLineId === LINE.energy)!
      v.endMonth = '2027-04'
    })
    expect(editableLine(archived, LINE.energy)?.editable).toBe(false)
  })
})

describe('a new line (spec 3.6)', () => {
  const ctx = context('2027-03-15')

  it('offers the categories one can still choose, by section, subcategories after their category', () => {
    const groups = categoryChoices(ctx)
    const courant = groups.find((g) => g.section === 'Dépenses courantes')!
    const labels = courant.items.map((c) => c.label)
    expect(labels.indexOf('Courses')).toBeLessThan(labels.indexOf('Courses > Supermarché'))
  })

  it('shows the months obtained, anchored on the first month, then the request', () => {
    const draft = { label: ' Cantine ', categoryId: CAT.childcare, amount: '90,50', kind: 'every_n' as const, everyN: '2', months: [], anchor: null }
    expect(newLineState(draft, '2027-04')).toEqual({ invalid: null, months: 'avril, juin, août, octobre et décembre 2027, puis février 2028…' })
    expect(newLineRequest(draft, '2027-04')).toEqual({
      label: 'Cantine',
      categoryId: CAT.childcare,
      amountCents: 9050,
      startMonth: '2027-04',
      rhythm: { kind: 'every_n', everyN: 2 },
    })
    expect(newLineState({ ...draft, everyN: '1' }, '2027-04').months).toBe('tous les mois, à partir de avril 2027')
    expect(newLineState({ ...draft, kind: 'months', months: [] }, '2027-04').invalid).toBe('Coche au moins un mois.')
    expect(newLineState({ ...draft, amount: '0' }, '2027-04').invalid).toBe('Montant : un nombre positif, en euros.')
  })

  it('opens from « Ajouter une ligne de budget » with its category chosen', () => {
    expect(newLinePath(null, CAT.pharmacy)).toBe(`/budget?nouvelle=${CAT.pharmacy}`)
    expect(placeFromLocation('/budget', `?nouvelle=${CAT.pharmacy}`).newLine).toEqual({ categoryId: CAT.pharmacy })
    expect(placeFromLocation('/budget', '?nouvelle').newLine).toEqual({ categoryId: null })
    expect(placeFromLocation('/budget/categories', '?nouvelle').newLine).toBeNull()
  })
})

describe('overrides (spec 3.6)', () => {
  const ctx = context('2027-03-15')

  it('the current month or later, where the line applies; with the override in force', () => {
    expect(overrideTarget(ctx, LINE.groceries, '2027-03')).toMatchObject({ versionCents: euros(800), current: { amountCents: euros(950), reason: 'Anniversaire' } })
    expect(overrideTarget(ctx, LINE.cats, '2027-04')).toMatchObject({ versionCents: euros(40), current: null })
    expect(overrideTarget(ctx, LINE.cats, '2027-02')).toBeNull()
    expect(overrideTarget(ctx, LINE.insuranceCar, '2027-05')).toBeNull()
  })
})

describe('months in words', () => {
  it('groups by year', () => {
    expect(monthsText(['2027-07'], false)).toBe('juillet 2027')
    expect(monthsText(['2027-11', '2028-01'], true)).toBe('novembre 2027, puis janvier 2028…')
    expect(monthsText([], false)).toBe('aucun mois')
  })
})

describe('due months of « tous les N mois » (calage)', () => {
  it('names each choice by its first three due months', async () => {
    const { dueMonthsText, sentence } = await import('../src/budget/lines')
    expect(dueMonthsText('2027-05', 2)).toBe('mai, juillet et septembre 2027…')
    expect(dueMonthsText('2027-11', 2)).toBe('novembre 2027, puis janvier et mars 2028…')
    expect(sentence('juillet 2027')).toBe('juillet 2027.')
    expect(sentence('mai 2028…')).toBe('mai 2028…')
  })
})
