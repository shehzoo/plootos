// Sorting of an import (R8, R9, spec 4.4): already present, manual operations to merge, new.
// The Worker runs it on preview and again just before writing; the browser shows its result.

import type { Id, IsoDate, Operation } from './model'

/** One operation read from the statement, label already normalized. */
export interface ImportRow {
  opDate: IsoDate
  valueDate: IsoDate
  amountCents: number
  bankLabel: string
  bankLabelRaw: string
}

/** Rows and manual operations with the same value date and amount: pairs are chosen one by one (R9). */
export interface MergeGroup {
  valueDate: IsoDate
  amountCents: number
  rowIndexes: number[]
  operationIds: Id[]
}

export interface ImportSort {
  /** Rows valued on or before the opening balance date: set aside and reported (R6). */
  excluded: number[]
  /** Rows already in the app (R8). */
  alreadyPresent: number[]
  /** Rows that may merge with a manual operation (R9). */
  toMerge: MergeGroup[]
  /** Rows to import as new, merge candidates left out. */
  fresh: number[]
  /** Rank among identical imported operations, for every row that would be written (spec 4.4). */
  dupRank: Map<number, number>
}

const rowKey = (r: Pick<ImportRow, 'opDate' | 'valueDate' | 'amountCents' | 'bankLabel'>) =>
  `${r.opDate}|${r.valueDate}|${r.amountCents}|${r.bankLabel}`
const mergeKey = (valueDate: IsoDate, amountCents: number) => `${valueDate}|${amountCents}`

export function sortImport(rows: ImportRow[], operations: Operation[], openingBalanceDate: IsoDate): ImportSort {
  const result: ImportSort = { excluded: [], alreadyPresent: [], toMerge: [], fresh: [], dupRank: new Map() }

  // R8: identical imported operations already stored, counted, with their highest rank.
  const stored = new Map<string, { count: number; maxRank: number }>()
  for (const o of operations) {
    if (o.origin !== 'import' || o.bankLabel === null) continue
    const key = rowKey({ ...o, bankLabel: o.bankLabel })
    const s = stored.get(key) ?? { count: 0, maxRank: 0 }
    s.count += 1
    s.maxRank = Math.max(s.maxRank, o.dupRank ?? 0)
    stored.set(key, s)
  }

  const seen = new Map<string, number>()
  const remaining: number[] = []
  rows.forEach((row, index) => {
    if (row.valueDate <= openingBalanceDate) {
      result.excluded.push(index)
      return
    }
    const key = rowKey(row)
    const nth = (seen.get(key) ?? 0) + 1
    seen.set(key, nth)
    const s = stored.get(key) ?? { count: 0, maxRank: 0 }
    // Occurrences are counted: the first `count` identical rows are already there.
    if (nth <= s.count) {
      result.alreadyPresent.push(index)
      return
    }
    result.dupRank.set(index, s.maxRank + nth - s.count)
    remaining.push(index)
  })

  // R9: manual operations not archived (never a deleted one), by value date and amount.
  const manual = new Map<string, Id[]>()
  for (const o of operations) {
    if (o.origin !== 'manual' || o.archivedAt !== null) continue
    const key = mergeKey(o.valueDate, o.amountCents)
    manual.set(key, [...(manual.get(key) ?? []), o.id])
  }
  const groups = new Map<string, MergeGroup>()
  for (const index of remaining) {
    const row = rows[index] as ImportRow
    const key = mergeKey(row.valueDate, row.amountCents)
    const operationIds = manual.get(key)
    if (!operationIds) {
      result.fresh.push(index)
      continue
    }
    const group = groups.get(key) ?? { valueDate: row.valueDate, amountCents: row.amountCents, rowIndexes: [], operationIds }
    group.rowIndexes.push(index)
    groups.set(key, group)
  }
  result.toMerge = [...groups.values()]
  return result
}

export interface MergePair {
  rowIndex: number
  operationId: Id
}

/**
 * Checks the pairs confirmed by the person against a sort: each pair within one group, each
 * row and each manual operation used once. Rows of a group left without a pair import as new.
 */
export function checkMergePairs(sort: ImportSort, pairs: MergePair[]): boolean {
  const rowGroup = new Map<number, MergeGroup>()
  for (const g of sort.toMerge) for (const i of g.rowIndexes) rowGroup.set(i, g)
  const rows = new Set<number>()
  const ops = new Set<Id>()
  for (const p of pairs) {
    const group = rowGroup.get(p.rowIndex)
    if (!group || !group.operationIds.includes(p.operationId)) return false
    if (rows.has(p.rowIndex) || ops.has(p.operationId)) return false
    rows.add(p.rowIndex)
    ops.add(p.operationId)
  }
  return true
}

/**
 * Foreseeable balance gap of an import (spec 4.4, step 4): the app balance at the statement
 * date once the rows are written, minus the bank's balance. A merged row replaces a manual
 * operation of the same value date and amount, so it does not move the balance.
 *
 * @param balanceAt C7 on the data before the import
 */
export function importBalanceGap(
  balanceAt: (date: IsoDate) => number,
  rows: ImportRow[],
  sort: ImportSort,
  pairs: MergePair[],
  statement: { date: IsoDate; balanceCents: number },
): number {
  const merged = new Set(pairs.map((p) => p.rowIndex))
  const written = [...sort.fresh, ...sort.toMerge.flatMap((g) => g.rowIndexes).filter((i) => !merged.has(i))]
  let balance = balanceAt(statement.date)
  for (const i of written) {
    const row = rows[i] as ImportRow
    if (row.valueDate <= statement.date) balance += row.amountCents
  }
  return balance - statement.balanceCents
}
