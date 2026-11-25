// Lot 9: the pure functions behind the manual entry, the record of an operation and Catégoriser
// (spec 3.2, 3.3, R2, R5, R6, R11), on the example month (spec 1.3).

import { describe, expect, it } from 'vitest'
import { CAT, exampleSeedInput } from '../../shared/fixtures/example'
import { seedResponse, toSeed } from '../../shared/fixtures/seed'
import { absorbInFirstPart, Ledger, partsError, type IsoDate } from '../../shared/src/engine'
import { budgetData, decodeData } from '../../shared/src/wire'
import type { MonthContext } from '../src/month/view'
import {
  categoryChoices,
  checkRows,
  emptyRow,
  exactCategory,
  fillFirst,
  matchCategories,
  readyRows,
  recordChange,
  recordDraft,
  rowCents,
  splitStatus,
  todoGroups,
  type EntryRow,
} from '../src/operations/entry'
import { addingPath, CATEGORIZE_PATH, placeFromLocation, withoutAdding } from '../src/router'

const AUTHORS = ['p1@example.test', 'p2@example.test'] as const
const USERS = new Map([
  ['p1@example.test', 'Personne 1'],
  ['p2@example.test', 'Personne 2'],
])

function context(today: IsoDate, options: { enteredUpTo?: IsoDate; withoutOperations?: boolean } = {}): MonthContext {
  const seed = toSeed(exampleSeedInput(options), AUTHORS)
  const app = decodeData(seedResponse(seed, USERS, today))
  return { ledger: new Ledger(budgetData(app)!), app, today }
}

const row = (amount: string, valueDate = '2027-03-16', extra: Partial<EntryRow> = {}): EntryRow => ({ ...emptyRow(valueDate), amount, ...extra })

describe('category field', () => {
  const ctx = context('2027-03-15', { enteredUpTo: '2027-03-15' })
  const choices = categoryChoices(ctx)

  it('offers the finest level only, in the order of the app (R2)', () => {
    const labels = choices.map((c) => c.label)
    expect(labels).toContain('Courses > Chats')
    expect(labels).not.toContain('Courses')
    expect(labels).not.toContain('Assurance')
    expect(labels).toContain('Énergie')
    expect(labels.indexOf('Salaires > Personne 1')).toBeLessThan(labels.indexOf('Logement'))
  })

  it('« cha » finds Courses > Chats; accents and case do not matter', () => {
    expect(matchCategories(choices, 'cha').map((c) => c.label)).toEqual(['Courses > Chats'])
    expect(matchCategories(choices, 'energie').map((c) => c.id)).toEqual([CAT.energy])
    expect(matchCategories(choices, 'cou sup').map((c) => c.id)).toEqual([CAT.supermarket])
    expect(exactCategory(choices, 'courses > CHATS')?.id).toBe(CAT.cats)
    expect(exactCategory(choices, 'Courses')).toBeNull()
  })
})

describe('manual entry (3.2, R5, R6)', () => {
  const ctx = context('2027-03-15', { enteredUpTo: '2027-03-15' })

  it('money out unless « + » on a computer; the switch on a phone', () => {
    expect(rowCents(row('42,50'), false)).toBe(-4250)
    expect(rowCents(row('+50'), false)).toBe(5000)
    expect(rowCents(row('50', undefined, { direction: 'in' }), true)).toBe(5000)
    expect(rowCents(row('50'), true)).toBe(-5000)
    expect(rowCents(row('0'), false)).toBeNull()
    expect(rowCents(row('abc'), false)).toBeNull()
  })

  it('R5: flags an operation already there, and an earlier row of the same entry', () => {
    // Supermarché, -210 € on 06/03, is in the example month.
    const checks = checkRows(ctx, [row('210', '2027-03-06'), row('12'), row('12')], false)
    expect(checks[0]?.duplicate).toMatch(/déjà dans l'appli/)
    expect(checks[1]?.duplicate).toBeNull()
    expect(checks[2]?.duplicate).toBe('Même montant et même date de valeur que la ligne 2.')
  })

  it('R6: refuses a value date on or before the opening balance; a row without amount blocks', () => {
    const rows = [row('10', '2027-02-28'), row('', '2027-03-16', { comment: 'Boulangerie' }), emptyRow('2027-03-16')]
    const checks = checkRows(ctx, rows, false)
    expect(checks[0]?.error).toBe('Date de valeur : après le 28/02/2027, date du solde initial.')
    expect(checks[1]?.error).toBe('Montant manquant.')
    expect(checks[2]?.error).toBeNull()
    expect(readyRows(rows, checks).blocked).toBe(true)
    const good = [row('12'), row('+20'), emptyRow('2027-03-16')]
    expect(readyRows(good, checkRows(ctx, good, false))).toEqual({ count: 2, totalCents: 800, blocked: false })
  })
})

describe('split (3.3)', () => {
  it('the first part takes what the others leave', () => {
    const drafts = fillFirst(
      [
        { categoryId: CAT.supermarket, amount: '260' },
        { categoryId: CAT.cats, amount: '45' },
      ],
      -26000,
    )
    expect(drafts[0]?.amount).toBe('215')
    expect(splitStatus(drafts, -26000)).toEqual({ ok: true, text: 'Tout est réparti' })
    expect(splitStatus([{ categoryId: CAT.supermarket, amount: '200' }, { categoryId: null, amount: '60' }], -26000).ok).toBe(false)
    expect(splitStatus([{ categoryId: CAT.supermarket, amount: '200' }], -26000).text).toMatch(/^Reste à répartir : 60/)
  })

  it('a new amount goes to the first part; a part that would change sign is refused', () => {
    const parts = [
      { categoryId: CAT.supermarket, amountCents: -21500 },
      { categoryId: CAT.cats, amountCents: -4500 },
    ]
    expect(absorbInFirstPart(parts, -27000)[0]?.amountCents).toBe(-22500)
    expect(partsError(absorbInFirstPart(parts, -4000), -4000)).toBe('part_sign')
  })
})

describe('record of an operation (3.2)', () => {
  const ctx = context('2027-04-01')

  it('suggests the category of the last operation with the same bank label (R11)', () => {
    // On 01/04 the import of 01/04 (Supermarché, 31/03) is categorized; seen uncategorized, it gets Courses > Supermarché.
    const ctx2 = context('2027-03-15', { enteredUpTo: '2027-03-15' })
    const groups = todoGroups(ctx2)
    expect(groups.flatMap((g) => g.rows)).toHaveLength(0)
    const o = ctx.ledger.data.operations.find((x) => x.amountCents === -23000)!
    expect(recordDraft(ctx, o).suggested).toBe(false)
  })

  it('an imported operation: only parts and comment are sent', () => {
    const o = ctx.ledger.data.operations.find((x) => x.amountCents === -21000)!
    const draft = recordDraft(ctx, o)
    const change = recordChange(ctx, o, { ...draft, amount: '999', comment: 'Anniversaire' })
    expect(change.body).toEqual({ comment: 'Anniversaire' })
    const split = recordChange(ctx, o, {
      ...draft,
      parts: [
        { categoryId: CAT.supermarket, amountCents: -20000 },
        { categoryId: CAT.cats, amountCents: -1000 },
      ],
    })
    expect(split.body.parts).toHaveLength(2)
    expect(split.error).toBeNull()
  })
})

describe('Catégoriser (3.3)', () => {
  it('lists every operation to categorize, by month of value date', () => {
    const ctx = context('2027-04-01', { withoutOperations: true })
    expect(todoGroups(ctx)).toEqual([])
  })
})

describe('places', () => {
  it('/operations/categoriser and ?ajout', () => {
    expect(placeFromLocation(CATEGORIZE_PATH, '')).toMatchObject({ section: 'operations', categorize: true, adding: false })
    expect(placeFromLocation('/operations', '?ajout')).toMatchObject({ section: 'operations', adding: true })
    expect(placeFromLocation('/', '?ajout')).toMatchObject({ section: 'mois', adding: true })
    expect(placeFromLocation('/budget', '?ajout').adding).toBe(false)
    expect(addingPath('/mois/2027-03')).toBe('/mois/2027-03?ajout')
    expect(withoutAdding('/mois/2027-03', '?ajout')).toBe('/mois/2027-03')
  })
})
