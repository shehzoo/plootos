// Operations entered by hand and their parts (spec 2.1, 3.2, 3.3, R2, R5, R6). Pure functions,
// shared by the app (alerts and previews) and the Worker (checks before writing).

import type { Id, IsoDate, Operation } from './model'

/** Most parts of one operation: far more than a split needs, a bound for the requests. */
export const MAX_PARTS = 20

/** A part as written: its category (null: still to be categorized) and its signed amount. */
export interface PartInput {
  categoryId: Id | null
  amountCents: number
}

export type PartsError = 'no_parts' | 'too_many_parts' | 'part_sign' | 'parts_sum' | 'part_uncategorized'

/**
 * Parts of an operation of this amount: at least one; each has the sign of the operation and is
 * never 0 (an operation of 0 has one part of 0); their sum is the amount. In a split, each part
 * has a category (spec 3.3).
 */
export function partsError(parts: PartInput[], amountCents: number): PartsError | null {
  if (parts.length === 0) return 'no_parts'
  if (parts.length > MAX_PARTS) return 'too_many_parts'
  for (const p of parts) {
    const sameSign = amountCents === 0 ? p.amountCents === 0 : p.amountCents !== 0 && Math.sign(p.amountCents) === Math.sign(amountCents)
    if (!sameSign) return 'part_sign'
  }
  if (parts.reduce((sum, p) => sum + p.amountCents, 0) !== amountCents) return 'parts_sum'
  if (parts.length > 1 && parts.some((p) => p.categoryId === null)) return 'part_uncategorized'
  return null
}

/**
 * The parts once the amount of the operation changes: the first part takes the difference,
 * as in « Répartir » (DECISIONS.md, 2026-11-25). Checked afterwards with partsError.
 */
export function absorbInFirstPart(parts: PartInput[], amountCents: number): PartInput[] {
  const [first, ...rest] = parts
  if (!first) return []
  const others = rest.reduce((sum, p) => sum + p.amountCents, 0)
  return [{ categoryId: first.categoryId, amountCents: amountCents - others }, ...rest.map((p) => ({ ...p }))]
}

/**
 * R5: an operation already there, not deleted, of the same amount and the same value date
 * (other than the one being changed), or null.
 */
export function duplicateOf(operations: readonly Operation[], valueDate: IsoDate, amountCents: number, exceptId: Id | null = null): Operation | null {
  return operations.find((o) => o.archivedAt === null && o.id !== exceptId && o.valueDate === valueDate && o.amountCents === amountCents) ?? null
}

/**
 * Value dates a manual entry accepts (R6): after the opening balance, and up to the last day of
 * the projection (December N+3, spec 3.5).
 */
export function manualDateError(valueDate: IsoDate, openingBalanceDate: IsoDate, today: IsoDate): 'value_date_too_early' | 'value_date_too_far' | null {
  if (valueDate <= openingBalanceDate) return 'value_date_too_early'
  if (valueDate > lastManualDate(today)) return 'value_date_too_far'
  return null
}

export const lastManualDate = (today: IsoDate): IsoDate => `${Number(today.slice(0, 4)) + 3}-12-31`
