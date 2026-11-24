// Sorting of an import (R8, R9): spec 1.4 case C and the cases of 4.4, on the fictitious export.

import { describe, expect, it } from 'vitest'
import {
  Ledger,
  checkMergePairs,
  importBalanceGap,
  sortImport,
  type BudgetData,
  type ImportRow,
  type MergePair,
  type Operation,
} from '../src/engine'
import { CAT, STATEMENT, euros, exampleData, exportRows } from '../fixtures/example'

const manual = (id: number, valueDate: string, amount: number, archivedAt: string | null = null): Operation => ({
  id,
  opDate: valueDate,
  valueDate,
  amountCents: euros(amount),
  origin: 'manual',
  bankLabel: null,
  bankLabelRaw: null,
  dupRank: null,
  comment: null,
  archivedAt,
})

/** Writes an import the way the Worker will (lot 10), on a copy of the data. */
function write(data: BudgetData, rows: ImportRow[], pairs: MergePair[]): BudgetData {
  const next = structuredClone(data)
  const sort = sortImport(rows, next.operations, next.openingBalance.balanceDate)
  let id = Math.max(0, ...next.operations.map((o) => o.id)) + 1
  const merged = new Map(pairs.map((p) => [p.rowIndex, p.operationId]))
  for (const index of [...sort.fresh, ...sort.toMerge.flatMap((g) => g.rowIndexes)]) {
    const row = rows[index] as ImportRow
    const bank = { ...row, origin: 'import' as const, dupRank: sort.dupRank.get(index) ?? 1 }
    const target = merged.get(index)
    const existing = next.operations.find((o) => o.id === target)
    if (existing) {
      // The merged operation takes the bank's fields and keeps its category and comment.
      Object.assign(existing, bank)
      continue
    }
    next.operations.push({ id, ...bank, comment: null, archivedAt: null })
    next.parts.push({ id: id * 10, operationId: id, categoryId: null, amountCents: row.amountCents })
    id += 1
  }
  return next
}

describe('case C: import with a refused merge (R9, U8)', () => {
  const data = exampleData({ withoutOperations: true })
  data.operations.push(manual(1, '2027-03-06', -210))
  data.parts.push({ id: 10, operationId: 1, categoryId: CAT.supermarket, amountCents: euros(-210) })
  const rows = exportRows()
  const sort = sortImport(rows, data.operations, data.openingBalance.balanceDate)
  const ledger = new Ledger(data)
  const supermarket = rows.findIndex((r) => r.valueDate === '2027-03-06')

  it('sums up: 0 already present, 1 manual operation to merge, 12 new', () => {
    expect(sort.excluded).toEqual([])
    expect(sort.alreadyPresent).toEqual([])
    expect(sort.toMerge).toEqual([{ valueDate: '2027-03-06', amountCents: euros(-210), rowIndexes: [supermarket], operationIds: [1] }])
    expect(sort.fresh).toHaveLength(12)
  })

  describe('merge refused', () => {
    const after = write(data, rows, [])

    it('foresees a -210 € gap, then finds it on 02/04/2027', () => {
      expect(importBalanceGap((d) => ledger.balanceAt(d), rows, sort, [], STATEMENT)).toBe(euros(-210))
      expect(after.operations).toHaveLength(14)
      expect(new Ledger(after).balanceAt(STATEMENT.date)).toBe(euros(4558))
    })

    it('finds no gap once the manual operation is deleted', () => {
      const deleted = structuredClone(after)
      deleted.operations.find((o) => o.id === 1)!.archivedAt = '2027-04-02T10:00:00Z'
      expect(new Ledger(deleted).balanceAt(STATEMENT.date) - STATEMENT.balanceCents).toBe(0)
    })

    it('finds the 13 operations already present on a second import', () => {
      const again = sortImport(rows, after.operations, after.openingBalance.balanceDate)
      expect(again.alreadyPresent).toHaveLength(13)
      expect(again.fresh).toEqual([])
      expect(again.toMerge).toEqual([])
    })
  })

  describe('merge confirmed (control)', () => {
    const pairs = [{ rowIndex: supermarket, operationId: 1 }]
    const after = write(data, rows, pairs)

    it('keeps 13 imported operations, the former manual one categorized Courses > Supermarché', () => {
      expect(checkMergePairs(sort, pairs)).toBe(true)
      expect(after.operations).toHaveLength(13)
      expect(after.operations.every((o) => o.origin === 'import')).toBe(true)
      expect(after.parts.find((p) => p.operationId === 1)?.categoryId).toBe(CAT.supermarket)
    })

    it('foresees no gap and finds none: 4,768 €', () => {
      expect(importBalanceGap((d) => ledger.balanceAt(d), rows, sort, pairs, STATEMENT)).toBe(0)
      expect(new Ledger(after).balanceAt(STATEMENT.date)).toBe(euros(4768))
    })

    it('finds the 13 operations already present on a second import', () => {
      expect(sortImport(rows, after.operations, after.openingBalance.balanceDate).alreadyPresent).toHaveLength(13)
    })
  })
})

describe('cases of spec 4.4', () => {
  const rows = exportRows()

  it('reimporting the example gives 13 operations already present', () => {
    const data = exampleData()
    const sort = sortImport(rows, data.operations, data.openingBalance.balanceDate)
    expect(sort.alreadyPresent).toHaveLength(13)
    expect(sort.fresh).toHaveLength(0)
  })

  it('merges a manual -230 € valued 01/04 with the row dated 31/03, then recognizes it', () => {
    const data = exampleData({ enteredUpTo: '2027-03-31' })
    data.operations.push(manual(40, '2027-04-01', -230))
    data.parts.push({ id: 400, operationId: 40, categoryId: CAT.supermarket, amountCents: euros(-230) })
    const sort = sortImport(rows, data.operations, data.openingBalance.balanceDate)
    expect(sort.alreadyPresent).toHaveLength(12)
    expect(sort.toMerge).toEqual([{ valueDate: '2027-04-01', amountCents: euros(-230), rowIndexes: [0], operationIds: [40] }])
    const after = write(data, rows, [{ rowIndex: 0, operationId: 40 }])
    expect(after.operations.find((o) => o.id === 40)).toMatchObject({ opDate: '2027-03-31', origin: 'import', dupRank: 1 })
    expect(sortImport(rows, after.operations, after.openingBalance.balanceDate).alreadyPresent).toHaveLength(13)
  })

  it('never offers to merge a deleted manual operation', () => {
    const data = exampleData({ enteredUpTo: '2027-03-31' })
    data.operations.push(manual(41, '2027-04-01', -230, '2027-04-01T09:00:00Z'))
    const sort = sortImport(rows, data.operations, data.openingBalance.balanceDate)
    expect(sort.toMerge).toEqual([])
    expect(sort.fresh).toEqual([0])
  })

  it('sets aside the rows valued on or before the opening balance date (R6)', () => {
    const data = exampleData({ withoutOperations: true })
    data.openingBalance.balanceDate = '2027-03-01'
    const sort = sortImport(rows, data.operations, data.openingBalance.balanceDate)
    expect(sort.excluded).toHaveLength(2)
    expect(sort.fresh).toHaveLength(11)
  })
})

describe('identical rows (R8, ranks)', () => {
  const row: ImportRow = {
    opDate: '2027-03-10',
    valueDate: '2027-03-10',
    amountCents: euros(-4),
    bankLabel: 'PAIEMENT PAR CARTE - BOULANGERIE EXEMPLE 10/03 - VILLE EXEMPLE',
    bankLabelRaw: 'PAIEMENT PAR CARTE - X0000 BOULANGERIE EXEMPLE 10/03 - VILLE EXEMPLE',
  }

  it('counts occurrences: two identical rows with one already stored give one new, rank 2', () => {
    const data = exampleData({ withoutOperations: true })
    data.operations.push({ id: 1, ...row, origin: 'import', dupRank: 1, comment: null, archivedAt: null })
    const sort = sortImport([row, { ...row }], data.operations, data.openingBalance.balanceDate)
    expect(sort.alreadyPresent).toEqual([0])
    expect(sort.fresh).toEqual([1])
    expect(sort.dupRank.get(1)).toBe(2)
  })

  it('ranks identical new rows 1, 2, 3', () => {
    const sort = sortImport([row, { ...row }, { ...row }], [], '2027-02-28')
    expect([...sort.dupRank.values()]).toEqual([1, 2, 3])
  })

  it('a manual operation never counts as already present', () => {
    const sort = sortImport([row], [manual(1, '2027-03-10', -4)], '2027-02-28')
    expect(sort.alreadyPresent).toEqual([])
    expect(sort.toMerge).toHaveLength(1)
  })
})

describe('merge pairs (R9)', () => {
  const rows: ImportRow[] = [0, 1].map((i) => ({
    opDate: '2027-03-10',
    valueDate: '2027-03-10',
    amountCents: euros(-20),
    bankLabel: `PRELEVEMENT - EXEMPLE ${i}`,
    bankLabelRaw: `PRELEVEMENT - EXEMPLE ${i}`,
  }))
  const ops = [manual(1, '2027-03-10', -20), manual(2, '2027-03-10', -20)]
  const sort = sortImport(rows, ops, '2027-02-28')

  it('groups several rows and several manual operations, to pair one by one', () => {
    expect(sort.toMerge).toEqual([{ valueDate: '2027-03-10', amountCents: euros(-20), rowIndexes: [0, 1], operationIds: [1, 2] }])
    expect(checkMergePairs(sort, [{ rowIndex: 0, operationId: 2 }, { rowIndex: 1, operationId: 1 }])).toBe(true)
  })

  it('refuses a row or an operation used twice, or a pair outside a group', () => {
    expect(checkMergePairs(sort, [{ rowIndex: 0, operationId: 1 }, { rowIndex: 1, operationId: 1 }])).toBe(false)
    expect(checkMergePairs(sort, [{ rowIndex: 0, operationId: 1 }, { rowIndex: 0, operationId: 2 }])).toBe(false)
    expect(checkMergePairs(sort, [{ rowIndex: 0, operationId: 3 }])).toBe(false)
  })
})
