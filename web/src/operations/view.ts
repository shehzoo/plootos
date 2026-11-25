// What the operations screen shows (spec 3.2), read only (lot 6): the operations of a month by
// value date, and the record of one operation. Pure functions, tested on the example month.

import { addMonths, monthOf, type Id, type IsoDate, type Ledger, type Month, type Operation } from '../../../shared/src/engine'
import { monthBounds, isUncategorized, latestCheck, path, type CheckInfo, type MonthContext } from '../month/view'

export interface OperationsBounds {
  /** First month followed (spec 3.1). */
  first: Month
  current: Month
  /** The current month, or later when an operation is already valued in a later month. */
  last: Month
}

export function operationsBounds(ctx: MonthContext): OperationsBounds {
  const bounds = monthBounds(ctx)
  let last = bounds.current
  for (const o of ctx.ledger.data.operations) {
    if (o.archivedAt === null && o.valueDate > ctx.ledger.data.openingBalance.balanceDate) {
      const m = monthOf(o.valueDate)
      if (m > last) last = m
    }
  }
  return { first: bounds.first, current: bounds.current, last: last > bounds.last ? bounds.last : last }
}

/** The month to show for a requested one: outside the bounds, the current month. */
export function clampOperationsMonth(month: Month | null, bounds: OperationsBounds): Month {
  if (month === null || month < bounds.first || month > bounds.last) return bounds.current
  return month
}

export interface OperationRow {
  id: Id
  valueDate: IsoDate
  /** Bank label (first line, normalized), else the comment of a manual entry, else empty. */
  label: string
  /** A comment shown under the label when the label is the bank's. */
  comment: string | null
  manual: boolean
  /** « À catégoriser », « Répartie (2) » or « Courses > Supermarché ». */
  categoryText: string
  uncategorized: boolean
  /** Signed, as on the statement. */
  amountCents: number
}

export interface OperationsView {
  month: Month
  rows: OperationRow[]
  uncategorizedCount: number
  /** Operations already entered whose value date falls in a later month. */
  laterCount: number
  appBalanceCents: number
  check: CheckInfo | null
}

function categoryText(ledger: Ledger, o: Operation): string {
  const parts = ledger.partsOf(o.id)
  if (isUncategorized(ledger, o)) return 'À catégoriser'
  if (parts.length > 1) return `Répartie (${parts.length})`
  const only = parts[0]
  return only && only.categoryId !== null ? path(ledger, only.categoryId) : 'À catégoriser'
}

function rowOf(ledger: Ledger, o: Operation): OperationRow {
  const manual = o.origin === 'manual'
  return {
    id: o.id,
    valueDate: o.valueDate,
    label: o.bankLabel ?? o.comment ?? '',
    comment: o.bankLabel && o.comment ? o.comment : null,
    manual,
    categoryText: categoryText(ledger, o),
    uncategorized: isUncategorized(ledger, o),
    amountCents: o.amountCents,
  }
}

export function operationsView(ctx: MonthContext, month: Month): OperationsView {
  const { ledger, today } = ctx
  const rows = [...ledger.monthOperations(month)]
    .sort((a, b) => (a.valueDate > b.valueDate ? -1 : a.valueDate < b.valueDate ? 1 : b.id - a.id))
    .map((o) => rowOf(ledger, o))
  const next = addMonths(month, 1)
  const laterCount = ledger.data.operations.filter(
    (o) => o.archivedAt === null && o.valueDate > ledger.data.openingBalance.balanceDate && monthOf(o.valueDate) >= next,
  ).length
  return {
    month,
    rows,
    uncategorizedCount: rows.filter((r) => r.uncategorized).length,
    laterCount,
    appBalanceCents: ledger.balanceAt(today),
    check: latestCheck(ctx, today),
  }
}

export interface OperationPartView {
  /** « Courses > Supermarché » or « À catégoriser ». */
  categoryText: string
  uncategorized: boolean
  amountCents: number
}

export interface OperationDetail {
  id: Id
  valueDate: IsoDate
  amountCents: number
  manual: boolean
  /** Title of the record: the bank's label, or « Ajout manuel ». */
  title: string
  comment: string | null
  /** Raw first line of the bank's label, imported operations only. */
  bankLabel: string | null
  parts: OperationPartView[]
  split: boolean
  /** « Importée par Personne 1 le 05/03/2027 » */
  origin: { manual: boolean; by: string; on: IsoDate }
  /** Who categorized it, when it has been and has one part. */
  categorizedBy: string | null
}

export function operationDetail(ctx: MonthContext, id: Id): OperationDetail | null {
  const { ledger, app } = ctx
  const o = ledger.data.operations.find((x) => x.id === id && x.archivedAt === null)
  if (!o) return null
  const stored = app.operations.find((x) => x.id === id)
  const parts = ledger.partsOf(id).map((p) => ({
    categoryText: p.categoryId === null ? 'À catégoriser' : path(ledger, p.categoryId),
    uncategorized: p.categoryId === null,
    amountCents: p.amountCents,
  }))
  const storedParts = app.parts.filter((p) => p.operationId === id)
  const only = storedParts.length === 1 ? storedParts[0] : undefined
  return {
    id,
    valueDate: o.valueDate,
    amountCents: o.amountCents,
    manual: o.origin === 'manual',
    title: o.bankLabel ?? 'Ajout manuel',
    comment: o.comment,
    bankLabel: o.bankLabelRaw,
    parts,
    split: parts.length > 1,
    origin: { manual: o.origin === 'manual', by: stored?.createdBy ?? '?', on: (stored?.createdAt ?? '').slice(0, 10) },
    categorizedBy: only && only.categoryId !== null ? only.updatedBy : null,
  }
}
