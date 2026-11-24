// Paris time (spec 4.3: tests at 23:30 and on the 1st of a month), bank dates, labels and R11.

import { describe, expect, it } from 'vitest'
import {
  Ledger,
  addMonths,
  currentMonthInParis,
  lastDayOfMonth,
  normalizeBankLabel,
  parseBankDate,
  suggestionKey,
  todayInParis,
} from '../src/engine'
import { CAT, EXPORT, exampleData } from './fixtures'

describe('today and the current month, in Paris', () => {
  it.each([
    // Winter time (UTC+1).
    ['2027-02-28T22:30:00Z', '2027-02-28', '2027-02'], // 23:30 on the last day of the month
    ['2027-02-28T23:30:00Z', '2027-03-01', '2027-03'], // 00:30 on the 1st: new month, still the 28th in UTC
    ['2026-12-31T22:30:00Z', '2026-12-31', '2026-12'], // 23:30 on New Year's Eve
    ['2026-12-31T23:00:00Z', '2027-01-01', '2027-01'], // midnight on 1 January
    // Summer time (UTC+2).
    ['2027-03-31T21:30:00Z', '2027-03-31', '2027-03'], // 23:30 on 31 March
    ['2027-03-31T22:30:00Z', '2027-04-01', '2027-04'], // 00:30 on 1 April
    ['2027-03-15T21:30:00Z', '2027-03-15', '2027-03'], // the evening of 15/03 (spec 1.3)
  ])('at %s it is %s in Paris', (instant, day, month) => {
    const now = new Date(instant)
    expect(todayInParis(now)).toBe(day)
    expect(currentMonthInParis(now)).toBe(month)
  })

  it('follows the change of time on the night of 28 March 2027', () => {
    expect(todayInParis(new Date('2027-03-27T22:59:00Z'))).toBe('2027-03-27') // 23:59 UTC+1
    expect(todayInParis(new Date('2027-03-28T21:59:00Z'))).toBe('2027-03-28') // 23:59 UTC+2
    expect(todayInParis(new Date('2027-03-28T22:00:00Z'))).toBe('2027-03-29')
  })
})

describe('months', () => {
  it('adds months across years and finds the last day', () => {
    expect(addMonths('2027-11', 3)).toBe('2028-02')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29')
    expect(lastDayOfMonth('2027-02')).toBe('2027-02-28')
    expect(lastDayOfMonth('2027-04')).toBe('2027-04-30')
  })
})

describe('bank dates', () => {
  it('reads DD/MM/YYYY text', () => {
    expect(parseBankDate('31/03/2027')).toBe('2027-03-31')
    expect(parseBankDate(' 01/04/2027 ')).toBe('2027-04-01')
  })

  it('reads a date cell in UTC, never in the device time zone', () => {
    expect(parseBankDate(new Date(Date.UTC(2027, 2, 31)))).toBe('2027-03-31')
  })

  it('refuses what is not a date', () => {
    expect(parseBankDate('31/02/2027')).toBeNull()
    expect(parseBankDate('2027-03-31')).toBeNull()
    expect(parseBankDate('')).toBeNull()
    expect(parseBankDate(new Date(Number.NaN))).toBeNull()
  })
})

describe('bank labels', () => {
  it('keeps the first line, without the card fragment', () => {
    expect(EXPORT.map(([, , label]) => normalizeBankLabel(label))).toEqual([
      'PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE 31/03 - VILLE EXEMPLE',
      'VIREMENT EN VOTRE FAVEUR - CPAM EXEMPLE REMBOURSEMENT',
      'PAIEMENT PAR CARTE - PHARMACIE EXEMPLE 28/03 - VILLE EXEMPLE',
      'VIREMENT EMIS - VERS LIVRET A EXEMPLE',
      'PRELEVEMENT - ASSUREUR EXEMPLE - ASSURANCE HABITATION',
      'PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE 19/03 - VILLE EXEMPLE',
      'VIREMENT EMIS - CRECHE EXEMPLE MARS',
      'PRELEVEMENT - ENERGIE EXEMPLE - FACTURE MENSUELLE',
      'PAIEMENT PAR CARTE - BOUCHERIE EXEMPLE 11/03 - VILLE EXEMPLE',
      'PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE 05/03 - VILLE EXEMPLE',
      'PRELEVEMENT - BANQUE EXEMPLE - ECHEANCE PRET',
      'VIREMENT EN VOTRE FAVEUR - EMPLOYEUR B EXEMPLE SALAIRE',
      'VIREMENT EN VOTRE FAVEUR - EMPLOYEUR A EXEMPLE SALAIRE',
    ])
  })

  it('collapses spaces and handles Windows line breaks', () => {
    expect(normalizeBankLabel('  PAIEMENT PAR CARTE  -  X1234 SHOP\r\nREF')).toBe('PAIEMENT PAR CARTE - SHOP')
  })

  it('cuts the suggestion key at the purchase date', () => {
    expect(suggestionKey('PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE 19/03 - VILLE EXEMPLE')).toBe(
      'PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE',
    )
    expect(suggestionKey('PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE 05/03 - AUTRE VILLE')).toBe(
      'PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE',
    )
    expect(suggestionKey('PRELEVEMENT - ENERGIE EXEMPLE - FACTURE MENSUELLE')).toBe(
      'PRELEVEMENT - ENERGIE EXEMPLE - FACTURE MENSUELLE',
    )
  })
})

describe('category suggestion (R11)', () => {
  const NEW_SHOPPING = 'PAIEMENT PAR CARTE - SUPERMARCHE EXEMPLE 02/04 - VILLE EXEMPLE'

  it('suggests the category of the latest operation of the same shop, any day', () => {
    // The latest one, valued 01/04, is in Supermarché; the split one of 20/03 is never a model.
    expect(new Ledger(exampleData()).suggestCategory(NEW_SHOPPING)).toBe(CAT.supermarket)
    expect(new Ledger(exampleData()).suggestCategory('PRELEVEMENT - ENERGIE EXEMPLE - FACTURE MENSUELLE')).toBe(CAT.energy)
  })

  it('never takes a split operation as a model', () => {
    // Up to 20/03, the only later supermarket operation is the split one: the 06/03 one counts.
    const data = exampleData({ enteredUpTo: '2027-03-20' })
    data.parts.find((p) => p.operationId === 4)!.categoryId = CAT.cats
    expect(new Ledger(data).suggestCategory(NEW_SHOPPING)).toBe(CAT.cats)
  })

  it('suggests nothing for an unknown label, an uncategorized model, or a category no longer choosable', () => {
    expect(new Ledger(exampleData()).suggestCategory('PRELEVEMENT - INCONNU')).toBeNull()
    expect(new Ledger(exampleData()).suggestCategory(null)).toBeNull()

    const uncategorized = exampleData()
    uncategorized.parts.find((p) => p.operationId === 13)!.categoryId = null
    // The latest categorized, unsplit supermarket operation is then the 06/03 one.
    expect(new Ledger(uncategorized).suggestCategory(NEW_SHOPPING)).toBe(CAT.supermarket)

    const archived = exampleData()
    archived.categories.find((c) => c.id === CAT.supermarket)!.archivedAt = '2027-04-01T00:00:00Z'
    expect(new Ledger(archived).suggestCategory(NEW_SHOPPING)).toBeNull()
  })

  it('treats a category with active subcategories as not choosable (R2)', () => {
    const ledger = new Ledger(exampleData())
    expect(ledger.isChoosable(CAT.groceries)).toBe(false)
    expect(ledger.isChoosable(CAT.supermarket)).toBe(true)
    expect(ledger.isChoosable(CAT.housing)).toBe(true)
  })
})
