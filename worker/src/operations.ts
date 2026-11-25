// Writes of lot 9 (spec 3.2, 3.3, R2, R5, R6, 4.3): manual entries, the record of an operation,
// categorizing, deleting a manual entry. Every route reads what it needs to check the request
// and answer clearly, then writes one all-or-nothing batch. The batch is guarded by the
// row_version of each operation it changes, which every write on its parts raises: if the other
// person changed it meanwhile, nothing is written ("Modifié entre-temps").

import { Hono } from 'hono'
import { MAX_CATEGORIZE, MAX_NEW_OPERATIONS } from '../../shared/src/api'
import { isIsoDate } from '../../shared/src/engine/dates'
import { absorbInFirstPart, manualDateError, MAX_PARTS, partsError, type PartInput } from '../../shared/src/engine/operations'
import { all, BadRequest, catalogBatch, fail, first, idParam, integer, MAX_CENTS, readBody, respond, route, rowVersion, type C } from './request'
import { serverToday } from './today'
import type { AppEnv } from './types'
import { lastInsertedId, type Value, type WriteBatch } from './write'

const MAX_ID = 1_000_000_000
/** D1 binds at most 100 values per statement. */
const CHUNK = 90

/**
 * R2: a part can go in this category now: it exists and is not archived, nor is its parent or
 * its section, and it has no subcategory still in use (the finest level).
 */
const CHOOSABLE =
  'EXISTS (SELECT 1 FROM category c LEFT JOIN category p ON p.id = c.parent_id ' +
  'JOIN section s ON s.id = coalesce(c.section_id, p.section_id) ' +
  'WHERE c.id = ? AND c.archived_at IS NULL AND (p.id IS NULL OR p.archived_at IS NULL) AND s.archived_at IS NULL ' +
  'AND NOT EXISTS (SELECT 1 FROM category k WHERE k.parent_id = c.id AND k.archived_at IS NULL))'

/** R5: no operation, not deleted, of this value date and amount, other than this one. */
const NO_DUPLICATE = 'NOT EXISTS (SELECT 1 FROM operation WHERE archived_at IS NULL AND value_date = ? AND amount_cents = ? AND id <> ?)'

/** R6: the value date comes after the opening balance. */
const AFTER_OPENING = 'EXISTS (SELECT 1 FROM opening_balance WHERE balance_date < ?)'

function comment(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw new BadRequest('comment')
  const text = v.trim()
  if (text.length > 500) throw new BadRequest('comment')
  return text === '' ? null : text
}

const signedAmount = (v: unknown) => {
  const amount = integer(v, 'amount', -MAX_CENTS, MAX_CENTS)
  if (amount === 0) throw new BadRequest('amount')
  return amount
}

function dateOf(v: unknown): string {
  if (typeof v !== 'string' || !isIsoDate(v)) throw new BadRequest('date')
  return v
}

const categoryOf = (v: unknown): number | null => (v === null ? null : integer(v, 'category', 1, MAX_ID))

function partsOf(v: unknown): PartInput[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_PARTS) throw new BadRequest('parts')
  return v.map((p) => {
    const part = (p ?? {}) as Record<string, unknown>
    return { categoryId: categoryOf(part.categoryId), amountCents: integer(part.amountCents, 'amount', -MAX_CENTS, MAX_CENTS) }
  })
}

function itemsOf(v: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw new BadRequest('items')
  return v.map((x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new BadRequest('items')
    return x as Record<string, unknown>
  })
}

const confirmed = (v: unknown) => {
  if (v !== undefined && typeof v !== 'boolean') throw new BadRequest('confirm')
  return v === true
}

async function openingDate(c: C): Promise<string | null> {
  return (await first<{ balance_date: string }>(c, 'SELECT balance_date FROM opening_balance'))?.balance_date ?? null
}

interface OperationRow {
  id: number
  origin: 'import' | 'manual'
  value_date: string
  amount_cents: number
  archived_at: string | null
}
interface PartRow {
  id: number
  operation_id: number
  category_id: number | null
  amount_cents: number
}

async function readOperations(c: C, ids: number[]): Promise<{ operations: Map<number, OperationRow>; parts: Map<number, PartRow[]> }> {
  const operations = new Map<number, OperationRow>()
  const parts = new Map<number, PartRow[]>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const marks = chunk.map(() => '?').join(', ')
    const [ops, ps] = await Promise.all([
      all<OperationRow>(c, `SELECT id, origin, value_date, amount_cents, archived_at FROM operation WHERE id IN (${marks})`, ...chunk),
      all<PartRow>(c, `SELECT id, operation_id, category_id, amount_cents FROM operation_part WHERE operation_id IN (${marks}) ORDER BY id`, ...chunk),
    ])
    for (const o of ops) operations.set(o.id, o)
    for (const p of ps) parts.set(p.operation_id, [...(parts.get(p.operation_id) ?? []), p])
  }
  return { operations, parts }
}

/**
 * Checks new parts against the ones there, before writing: a part keeps a category the operation
 * already had even if it can no longer be chosen (« Courses (sans détail) », R2); any other
 * category must be choosable, checked by a guard at write time. An operation goes back to « à
 * catégoriser » only if it already is (DECISIONS.md, 2026-11-25). Returns the categories to guard.
 */
function partsRule(parts: PartInput[], amountCents: number, existing: PartRow[]): { error: string } | { guard: number[] } {
  const error = partsError(parts, amountCents)
  if (error) return { error }
  const stillTodo = existing.length === 1 && existing[0]?.category_id === null
  if (parts.some((p) => p.categoryId === null) && !stillTodo) return { error: 'uncategorize_refused' }
  const had = new Set(existing.map((p) => p.category_id))
  return { guard: [...new Set(parts.map((p) => p.categoryId).filter((id): id is number => id !== null && !had.has(id)))] }
}

/** The parts written over the ones there: rows updated in order, extra ones inserted, the rest erased. */
function writeParts(w: WriteBatch, operationId: number, existing: PartRow[], parts: PartInput[]): void {
  parts.forEach((p, i) => {
    const row = existing[i]
    if (row) w.update('operation_part', row.id, { category_id: p.categoryId, amount_cents: p.amountCents })
    else w.insert('operation_part', { operation_id: operationId, category_id: p.categoryId, amount_cents: p.amountCents })
  })
  for (const row of existing.slice(parts.length)) w.erasePart(row.id)
}

const guardChoosable = (w: WriteBatch, ids: Iterable<number>) => {
  for (const id of ids) w.guard(CHOOSABLE, [id], 'category_not_choosable')
}

export const operations = new Hono<AppEnv>()

// Manual entries (spec 3.2): several at once, all or nothing.
operations.post(
  '/api/operations',
  route(async (c) => {
    const b = await readBody(c)
    const items = itemsOf(b.items, MAX_NEW_OPERATIONS).map((x) => ({
      valueDate: dateOf(x.valueDate),
      amountCents: signedAmount(x.amountCents),
      categoryId: categoryOf(x.categoryId ?? null),
      comment: comment(x.comment),
      confirm: confirmed(x.confirmDuplicate),
    }))
    const opening = await openingDate(c)
    if (opening === null) return fail(c, 422, 'not_set_up')
    const today = serverToday(c).today
    for (const it of items) {
      const refused = manualDateError(it.valueDate, opening, today)
      if (refused) return fail(c, 422, refused)
    }
    // R5 within the request: an entry like an earlier one of the same request is confirmed.
    const unconfirmed = items.some((it, i) => !it.confirm && items.slice(0, i).some((o) => o.valueDate === it.valueDate && o.amountCents === it.amountCents))
    if (unconfirmed) return fail(c, 422, 'duplicate_unconfirmed')

    const w = catalogBatch(c)
    for (const date of new Set(items.map((it) => it.valueDate))) w.guard(AFTER_OPENING, [date], 'value_date_too_early')
    for (const it of items) if (!it.confirm) w.guard(NO_DUPLICATE, [it.valueDate, it.amountCents, 0], 'duplicate_unconfirmed')
    guardChoosable(w, new Set(items.map((it) => it.categoryId).filter((id): id is number => id !== null)))
    for (const it of items) {
      w.insert('operation', { op_date: it.valueDate, value_date: it.valueDate, amount_cents: it.amountCents, origin: 'manual', comment: it.comment })
      w.insert('operation_part', { operation_id: lastInsertedId('operation'), category_id: it.categoryId, amount_cents: it.amountCents })
    }
    return respond(c, await w.run())
  }),
)

// « Enregistrer N opérations » and « Mettre dans… » (spec 3.3): all or nothing.
operations.post(
  '/api/operations/categorize',
  route(async (c) => {
    const b = await readBody(c)
    const items = itemsOf(b.items, MAX_CATEGORIZE).map((x) => ({
      id: integer(x.id, 'id', 1, MAX_ID),
      rowVersion: rowVersion(x.rowVersion),
      parts: partsOf(x.parts),
      comment: x.comment === undefined ? undefined : comment(x.comment),
    }))
    if (new Set(items.map((it) => it.id)).size !== items.length) throw new BadRequest('items')
    if (items.some((it) => it.parts.some((p) => p.categoryId === null))) return fail(c, 422, 'part_uncategorized')
    const read = await readOperations(
      c,
      items.map((it) => it.id),
    )

    const w = catalogBatch(c)
    const toGuard = new Set<number>()
    for (const it of items) {
      const op = read.operations.get(it.id)
      if (!op) return fail(c, 404, 'not_found')
      if (op.archived_at !== null) return fail(c, 422, 'operation_archived')
      const rule = partsRule(it.parts, op.amount_cents, read.parts.get(it.id) ?? [])
      if ('error' in rule) return fail(c, 422, rule.error)
      rule.guard.forEach((id) => toGuard.add(id))
      w.expectVersion('operation', it.id, it.rowVersion)
    }
    guardChoosable(w, toGuard)
    for (const it of items) {
      writeParts(w, it.id, read.parts.get(it.id) ?? [], it.parts)
      if (it.comment !== undefined) w.update('operation', it.id, { comment: it.comment })
      else w.touch('operation', it.id)
    }
    return respond(c, await w.run())
  }),
)

// The record of an operation (spec 3.2): category, parts, comment; for a manual entry, its
// amount and value date too. The bank's fields of an imported operation never change.
operations.patch(
  '/api/operations/:id',
  route(async (c) => {
    const id = idParam(c)
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    const amount = b.amountCents === undefined ? undefined : signedAmount(b.amountCents)
    const valueDate = b.valueDate === undefined ? undefined : dateOf(b.valueDate)
    const newComment = b.comment === undefined ? undefined : comment(b.comment)
    const sentParts = b.parts === undefined ? undefined : partsOf(b.parts)
    const confirm = confirmed(b.confirmDuplicate)
    if (amount === undefined && valueDate === undefined && newComment === undefined && sentParts === undefined) throw new BadRequest('nothing')

    const read = await readOperations(c, [id])
    const op = read.operations.get(id)
    if (!op) return fail(c, 404, 'not_found')
    if (op.archived_at !== null) return fail(c, 422, 'operation_archived')
    if ((amount !== undefined || valueDate !== undefined) && op.origin !== 'manual') return fail(c, 422, 'bank_fields')
    const existing = read.parts.get(id) ?? []
    const nextAmount = amount ?? op.amount_cents
    const nextDate = valueDate ?? op.value_date
    const moved = nextAmount !== op.amount_cents || nextDate !== op.value_date

    if (valueDate !== undefined && valueDate !== op.value_date) {
      const opening = await openingDate(c)
      if (opening === null) return fail(c, 422, 'not_set_up')
      const refused = manualDateError(valueDate, opening, serverToday(c).today)
      if (refused) return fail(c, 422, refused)
    }
    // The amount changes and no parts are sent: the first part takes the difference.
    const partsToWrite =
      sentParts ??
      (nextAmount !== op.amount_cents
        ? absorbInFirstPart(
            existing.map((p) => ({ categoryId: p.category_id, amountCents: p.amount_cents })),
            nextAmount,
          )
        : undefined)

    const w = catalogBatch(c).expectVersion('operation', id, version)
    if (partsToWrite) {
      const rule = partsRule(partsToWrite, nextAmount, existing)
      if ('error' in rule) return fail(c, 422, rule.error)
      guardChoosable(w, rule.guard)
    }
    if (moved && !confirm) w.guard(NO_DUPLICATE, [nextDate, nextAmount, id], 'duplicate_unconfirmed')
    if (valueDate !== undefined) w.guard(AFTER_OPENING, [nextDate], 'value_date_too_early')

    if (partsToWrite) writeParts(w, id, existing, partsToWrite)
    const values: Record<string, Value> = {}
    if (amount !== undefined) values.amount_cents = amount
    if (valueDate !== undefined) {
      values.value_date = valueDate
      values.op_date = valueDate
    }
    if (newComment !== undefined) values.comment = newComment
    if (Object.keys(values).length > 0) w.update('operation', id, values)
    else w.touch('operation', id)
    return respond(c, await w.run())
  }),
)

// « Supprimer » (spec 2.1): only a manual entry, which is archived; it leaves every calculation.
operations.post(
  '/api/operations/:id/delete',
  route(async (c) => {
    const id = idParam(c)
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    const op = (await readOperations(c, [id])).operations.get(id)
    if (!op) return fail(c, 404, 'not_found')
    if (op.origin !== 'manual') return fail(c, 422, 'not_manual')
    if (op.archived_at !== null) return fail(c, 422, 'operation_archived')
    const w = catalogBatch(c).expectVersion('operation', id, version)
    w.update('operation', id, { archived_at: w.now })
    return respond(c, await w.run())
  }),
)
