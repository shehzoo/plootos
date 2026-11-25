// Reading a statement (spec 4.4, step 2): the fictitious export, and the shapes a real one may
// take (date cells, thousands separators, a header elsewhere).

import { readFileSync } from 'node:fs'
import { readSheet } from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import { exportRows, STATEMENT } from '../fixtures/example'
import { cellCents, cellDate, HEADERS, readStatement, type SheetRows } from '../src/statement'

const file = decodeURIComponent(new URL('../fixtures/files/export-exemple.xlsx', import.meta.url).pathname)

describe('the fictitious export, read from the XLSX file', () => {
  it('gives the 13 rows of the fixtures and the « Solde au »', async () => {
    const sheet = (await readSheet(readFileSync(file), { parseNumber: (s: string) => s })) as SheetRows
    const read = readStatement(sheet, 2000)
    if ('error' in read) throw new Error(read.error)
    expect(read.balance).toEqual(STATEMENT)
    expect(read.rows).toEqual(exportRows())
  })

  it('keeps nothing from above the header but the balance', async () => {
    const sheet = (await readSheet(readFileSync(file), { parseNumber: (s: string) => s })) as SheetRows
    const read = readStatement(sheet, 2000)
    const sent = JSON.stringify(read)
    expect(sent).not.toContain('FICTIF')
    expect(sent).not.toContain('00000000000')
    expect(sent).not.toContain('Téléchargement')
  })
})

const header = [...HEADERS] as string[]
const sheet = (...rows: (string | number | Date | null)[][]): SheetRows => [
  ['Téléchargement du 02/04/2027'],
  ['M. EXEMPLE'],
  [null, null, 'Solde au 02/04/2027', '1 234,56 €'],
  header,
  ...rows,
]

describe('cells', () => {
  it('reads amounts without floating point', () => {
    expect(cellCents('0.1')).toBe(10)
    expect(cellCents('12.3')).toBe(1230)
    expect(cellCents('1.2E3')).toBe(120000)
    expect(cellCents('4768,00 €')).toBe(476800)
    expect(cellCents('4 768,5 €')).toBe(476850)
    expect(cellCents('1.234,56')).toBe(123456)
    expect(cellCents('-12,34 €')).toBe(-1234)
    expect(cellCents('69.93000000000001')).toBe(6993)
    expect(cellCents('0.30000000000000004')).toBe(30)
    expect(cellCents('12.345')).toBeNull()
    expect(cellCents('12,345')).toBeNull()
    expect(cellCents('abc')).toBeNull()
    expect(cellCents(null)).toBeNull()
  })

  it('reads dates as text or as date cells, in UTC', () => {
    expect(cellDate('31/03/2027')).toBe('2027-03-31')
    expect(cellDate(new Date(Date.UTC(2027, 2, 31)))).toBe('2027-03-31')
    expect(cellDate('31/02/2027')).toBeNull()
    expect(cellDate('2027-03-31')).toBeNull()
  })
})

describe('shapes of a statement', () => {
  it('finds the header by its content, in any column order, and skips empty rows', () => {
    const read = readStatement(
      [
        [null, null, 'Solde au 02/04/2027', '10,00 €'],
        ['Crédit euros', 'Libellé', 'Date valeur', 'Date', 'Débit euros'],
        ['5', 'AVOIR - X1234 BOUTIQUE 01/04 - VILLE', new Date(Date.UTC(2027, 3, 1)), '01/04/2027', null],
        [],
        [null, null, null, null, null],
        [null, 'PRELEVEMENT - EXEMPLE', '02/04/2027', '02/04/2027', '3'],
      ],
      10,
    )
    if ('error' in read) throw new Error(read.error)
    expect(read.rows.map((r) => [r.opDate, r.valueDate, r.amountCents, r.bankLabel])).toEqual([
      ['2027-04-01', '2027-04-01', 500, 'AVOIR - BOUTIQUE 01/04 - VILLE'],
      ['2027-04-02', '2027-04-02', -300, 'PRELEVEMENT - EXEMPLE'],
    ])
  })

  it("reads the header of a statement of November 2026: « Date d'opération » for the first column", () => {
    for (const title of ["Date d'opération", 'Date d\u2019opération']) {
      const read = readStatement(
        [[null, null, 'Solde au 25/11/2026', '10,00 €'], [title, 'Date valeur', 'Libellé', 'Débit euros', 'Crédit euros'], ['24/11/2026', '24/11/2026', 'PRELEVEMENT - EXEMPLE', '3', null]],
        10,
      )
      expect('error' in read ? read : read.rows.map((r) => r.amountCents)).toEqual([-300])
    }
  })

  it('says which row cannot be read', () => {
    expect(readStatement(sheet(['01/04/2027', '01/04/2027', 'X', '1', '2']), 10)).toEqual({ error: 'bad_row', line: 5 })
    expect(readStatement(sheet(['01/04/2027', '01/04/2027', 'X', null, null]), 10)).toEqual({ error: 'bad_row', line: 5 })
    expect(readStatement(sheet(['01/04/2027', 'hier', 'X', '1', null]), 10)).toEqual({ error: 'bad_row', line: 5 })
    expect(readStatement(sheet(['01/04/2027', '01/04/2027', '', '1', null]), 10)).toEqual({ error: 'bad_row', line: 5 })
  })

  it('reads a debit, a credit, a label on several lines, and the balance with a thousands separator', () => {
    const read = readStatement(
      sheet(
        ['31/03/2027', '01/04/2027', 'PAIEMENT PAR CARTE - X1234 BOUTIQUE 31/03 - VILLE', '12.3', null],
        [new Date(Date.UTC(2027, 3, 2)), new Date(Date.UTC(2027, 3, 2)), 'VIREMENT EN VOTRE FAVEUR - EXEMPLE\nREF0000', null, '100'],
      ),
      10,
    )
    if ('error' in read) throw new Error(read.error)
    expect(read.balance).toEqual({ date: '2027-04-02', balanceCents: 123456 })
    expect(read.rows).toEqual([
      {
        opDate: '2027-03-31',
        valueDate: '2027-04-01',
        amountCents: -1230,
        bankLabel: 'PAIEMENT PAR CARTE - BOUTIQUE 31/03 - VILLE',
        bankLabelRaw: 'PAIEMENT PAR CARTE - X1234 BOUTIQUE 31/03 - VILLE',
      },
      { opDate: '2027-04-02', valueDate: '2027-04-02', amountCents: 10000, bankLabel: 'VIREMENT EN VOTRE FAVEUR - EXEMPLE', bankLabelRaw: 'VIREMENT EN VOTRE FAVEUR - EXEMPLE' },
    ])
  })

  it('refuses a sheet without header, balance or rows, or too long', () => {
    expect(readStatement([['Nom', 'Prénom']], 10)).toEqual({ error: 'no_header' })
    expect(readStatement([header, ['01/04/2027', '01/04/2027', 'X', '1', null]], 10)).toEqual({ error: 'no_balance' })
    expect(readStatement(sheet(), 10)).toEqual({ error: 'no_rows' })
    const row = ['01/04/2027', '01/04/2027', 'X', '1', null]
    expect(readStatement(sheet(row, row, row), 2)).toEqual({ error: 'too_many_rows', count: 3 })
  })
})
