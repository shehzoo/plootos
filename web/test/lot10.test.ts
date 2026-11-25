// Lot 10: the pure functions behind the import screen and the balance check (spec 3.2, 4.4, U8),
// on the example month (spec 1.3) and the fictitious export.

import { describe, expect, it } from 'vitest'
import type { ImportPreview } from '../../shared/src/api'
import { CAT, euros, exampleSeedInput, exportRows, STATEMENT } from '../../shared/fixtures/example'
import { seedResponse, toSeed } from '../../shared/fixtures/seed'
import { Ledger, type IsoDate } from '../../shared/src/engine'
import { budgetData, decodeData } from '../../shared/src/wire'
import type { MonthContext } from '../src/month/view'
import {
  enteredSince,
  foreseenGap,
  gapWords,
  keptChoices,
  manualText,
  newCount,
  pairsOf,
  previewRequest,
  statementErrorText,
  undecidedCount,
  type MergeChoices,
} from '../src/operations/importing'
import { IMPORT_PATH, placeFromLocation } from '../src/router'

const AUTHORS = ['p1@example.test', 'p2@example.test'] as const
const USERS = new Map([
  ['p1@example.test', 'Personne 1'],
  ['p2@example.test', 'Personne 2'],
])

function context(today: IsoDate, options: { withoutOperations?: boolean } = {}): MonthContext {
  const seed = toSeed(exampleSeedInput(options), AUTHORS)
  const app = decodeData(seedResponse(seed, USERS, today))
  return { ledger: new Ledger(budgetData(app)!), app, today }
}

const rows = exportRows()
const supermarket = rows.findIndex((r) => r.valueDate === '2027-03-06')
/** Case C (spec 1.4): one manual entry of -210 € on 06/03, the 12 other rows new; C7 at 02/04 = 3,000 - 210. */
const caseC: ImportPreview = {
  excluded: [],
  alreadyPresent: [],
  toMerge: [{ valueDate: '2027-03-06', amountCents: euros(-210), rowIndexes: [supermarket], operationIds: [99] }],
  fresh: rows.map((_, i) => i).filter((i) => i !== supermarket),
  appBalanceCents: euros(2790),
  token: 't',
}

describe('summary of an import (spec 4.4, step 4)', () => {
  it('sends the rows with the raw first line of their label, and the « Solde au » only', () => {
    const sent = previewRequest({ balance: STATEMENT, rows })
    expect(sent.balance).toEqual(STATEMENT)
    expect(sent.rows[0]).toEqual({ opDate: '2027-03-31', valueDate: '2027-04-01', amountCents: euros(-230), bankLabelRaw: rows[0]!.bankLabelRaw })
    expect(Object.keys(sent.rows[0]!)).not.toContain('bankLabel')
  })

  it('case C: a merge to choose, then the gap follows the choice: -210 € refused, 0 € confirmed', () => {
    const none: MergeChoices = new Map()
    expect(undecidedCount(caseC, none)).toBe(1)
    expect(newCount(caseC, none)).toBe(13)
    const refused: MergeChoices = new Map([[supermarket, 'none']])
    expect(undecidedCount(caseC, refused)).toBe(0)
    expect(pairsOf(refused)).toEqual([])
    expect(newCount(caseC, refused)).toBe(13)
    expect(foreseenGap(caseC, rows, refused, STATEMENT)).toBe(euros(-210))
    const confirmed: MergeChoices = new Map([[supermarket, 99]])
    expect(pairsOf(confirmed)).toEqual([{ rowIndex: supermarket, operationId: 99 }])
    expect(newCount(caseC, confirmed)).toBe(12)
    expect(foreseenGap(caseC, rows, confirmed, STATEMENT)).toBe(0)
  })

  it('keeps the choices still possible when the sort changed meanwhile', () => {
    const choices: MergeChoices = new Map([[supermarket, 99]])
    expect(keptChoices(caseC, choices)).toEqual(choices)
    const gone = { ...caseC, toMerge: [], fresh: rows.map((_, i) => i) }
    expect(keptChoices(gone, choices).size).toBe(0)
    const other = { ...caseC, toMerge: [{ ...caseC.toMerge[0]!, operationIds: [100] }] }
    expect(keptChoices(other, choices).size).toBe(0)
    expect(keptChoices(other, new Map([[supermarket, 'none']]))).toEqual(new Map([[supermarket, 'none']]))
  })

  it('explains a file it cannot read, without any value from it', () => {
    expect(statementErrorText({ error: 'bad_row', line: 14 })).toContain('Ligne 14')
    expect(statementErrorText({ error: 'no_header' })).toContain('Date, Date valeur, Libellé, Débit euros, Crédit euros')
    expect(statementErrorText({ error: 'too_many_rows', count: 2500 })).toMatch(/2.?500.opérations/)
  })
})

describe('balance check (U8)', () => {
  it('says the gap in words', () => {
    expect(gapWords(0)).toBe('Identique à la banque.')
    expect(gapWords(euros(-210))).toBe("L'appli compte 210 € de moins que la banque.")
    expect(gapWords(euros(12.5))).toBe("L'appli compte 12,50 € de plus que la banque.")
  })

  it('lists the operations entered since the last check without a gap', () => {
    const ctx = context('2027-04-02')
    // The example's check (02/04, no gap) is recorded after every operation.
    const right = ctx.app.balanceChecks[0]!
    ctx.app.operations.push({ ...ctx.app.operations[0]!, id: 50, createdAt: '2027-04-02T21:30:00.000Z', bankLabel: null, comment: 'Marché' })
    ctx.app.balanceChecks.push({ ...right, id: 2, gapCents: euros(-12), createdAt: '2027-04-02T22:00:00.000Z' })
    ctx.app.balanceChecks.push({ ...right, id: 3, gapCents: euros(-12), createdAt: '2027-04-02T23:00:00.000Z' })
    // The second check with a gap still lists what came after the last right one.
    expect(enteredSince(ctx, 3)).toEqual({ since: '2027-04-02', operations: [expect.objectContaining({ id: 50, label: 'Ajout manuel · Marché' })] })
    // Without a right check before, every operation entered up to the check.
    expect(enteredSince(ctx, 1)).toMatchObject({ since: null })
    expect(enteredSince(ctx, 1).operations).toHaveLength(13)
  })

  it('describes a manual entry offered to merge', () => {
    const ctx = context('2027-03-10', { withoutOperations: true })
    ctx.app.operations.push({
      id: 1,
      opDate: '2027-03-06',
      valueDate: '2027-03-06',
      amountCents: euros(-210),
      origin: 'manual',
      bankLabel: null,
      bankLabelRaw: null,
      dupRank: null,
      comment: 'Anniversaire',
      archivedAt: null,
      createdBy: 'Personne 2',
      createdAt: '2027-03-06T10:00:00.000Z',
      updatedBy: 'Personne 2',
      updatedAt: '2027-03-06T10:00:00.000Z',
      rowVersion: 1,
    })
    ctx.app.parts.push({ id: 1, operationId: 1, categoryId: CAT.supermarket, amountCents: euros(-210), createdBy: 'Personne 2', createdAt: '', updatedBy: 'Personne 2', updatedAt: '', rowVersion: 1 })
    const fresh = { ...ctx, ledger: new Ledger(budgetData(ctx.app)!) }
    expect(manualText(fresh, 1)).toBe('Saisie du 06/03, Courses > Supermarché · « Anniversaire » · par Personne 2')
  })
})

describe('route', () => {
  it('/operations/importer opens the import screen, never with the manual entry', () => {
    expect(placeFromLocation(IMPORT_PATH, '?ajout')).toMatchObject({ section: 'operations', importing: true, categorize: false, adding: false, month: null })
    expect(placeFromLocation('/operations', '')).toMatchObject({ importing: false })
  })
})
