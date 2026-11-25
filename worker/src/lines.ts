// Writes of lot 8 (spec 3.6, R3, R4, 4.3): budget lines, their versions and their overrides.
// Each route reads the line, works out the change with the same pure functions as the app
// (shared/src/engine/versions.ts), then writes one all-or-nothing batch. The batch is guarded by
// the line's row_version, which every write on its versions and overrides raises: if the other
// person changed the line meanwhile, nothing is written ("Modifié entre-temps").

import { Hono } from 'hono'
import { isMonth, monthOf } from '../../shared/src/engine/dates'
import type { BudgetLineVersion, BudgetOverride, Month, Rhythm } from '../../shared/src/engine/model'
import { rhythmError, versionApplies } from '../../shared/src/engine/rhythm'
import { archiveLine, modifyLine, type LineChange, type LineChangeError, type NewVersion, type RhythmInput } from '../../shared/src/engine/versions'
import { all, BadRequest, catalogBatch, fail, first, idParam, integer, MAX_CENTS, nameOf, readBody, respond, route, rowVersion, type C } from './request'
import { serverToday } from './today'
import type { AppEnv } from './types'
import { lastInsertedId, type Value, type WriteBatch } from './write'

const MAX_ID = 1_000_000_000

/** Months a person may pick: from the current month to December N+3, the end of the projection. */
function monthIn(v: unknown, reason: string): Month {
  if (typeof v !== 'string' || !isMonth(v)) throw new BadRequest(reason)
  return v
}
const lastMonthOf = (current: Month) => `${Number(current.slice(0, 4)) + 3}-12`

function rhythmOf(v: unknown, allowAnchor: boolean): RhythmInput {
  const r = (v ?? {}) as Record<string, unknown>
  if (r.kind === 'every_n') {
    const everyN = integer(r.everyN, 'rhythm', 1, 120)
    if (r.anchorMonth === undefined) return { kind: 'every_n', everyN }
    if (!allowAnchor) throw new BadRequest('rhythm')
    return { kind: 'every_n', everyN, anchorMonth: monthIn(r.anchorMonth, 'rhythm') }
  }
  if (r.kind === 'months' && Array.isArray(r.months) && r.months.length <= 12) {
    return { kind: 'months', months: r.months.map((m) => integer(m, 'rhythm', 1, 12)) }
  }
  throw new BadRequest('rhythm')
}

const amountOf = (v: unknown) => integer(v, 'amount', 1, MAX_CENTS)

function reasonOf(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw new BadRequest('reason')
  const reason = v.trim()
  if (reason.length > 500) throw new BadRequest('reason')
  return reason === '' ? null : reason
}

interface VersionRow {
  id: number
  category_id: number
  amount_cents: number
  start_month: string
  end_month: string | null
  replaced_at: string | null
  rhythm: 'every_n' | 'months'
  every_n: number | null
  anchor_month: string | null
  months: string | null
}
interface OverrideRow {
  id: number
  month: string
  amount_cents: number
  reason: string | null
  removed_at: string | null
}

function rhythmFromRow(r: VersionRow): Rhythm {
  if (r.rhythm === 'every_n') return { kind: 'every_n', everyN: r.every_n as number, anchorMonth: r.anchor_month as string }
  return { kind: 'months', months: (r.months as string).split(',').map(Number) }
}

/** The line, its versions and its overrides, as the engine reads them; null if there is no such line. */
async function readLine(c: C, id: number) {
  const line = await first<{ id: number }>(c, 'SELECT id FROM budget_line WHERE id = ?', id)
  if (!line) return null
  const versions: BudgetLineVersion[] = (
    await all<VersionRow>(
      c,
      'SELECT id, category_id, amount_cents, start_month, end_month, replaced_at, rhythm, every_n, anchor_month, months FROM budget_line_version WHERE budget_line_id = ?',
      id,
    )
  ).map((r) => ({
    id: r.id,
    budgetLineId: id,
    categoryId: r.category_id,
    amountCents: r.amount_cents,
    startMonth: r.start_month,
    endMonth: r.end_month,
    replacedAt: r.replaced_at,
    rhythm: rhythmFromRow(r),
  }))
  const overrides: BudgetOverride[] = (
    await all<OverrideRow>(c, 'SELECT id, month, amount_cents, reason, removed_at FROM budget_override WHERE budget_line_id = ?', id)
  ).map((r) => ({ id: r.id, budgetLineId: id, month: r.month, amountCents: r.amount_cents, reason: r.reason, removedAt: r.removed_at }))
  return { versions, overrides }
}

/** The category exists and is not archived (R3: a version goes to a category one can still choose). */
async function categoryOpen(c: C, id: number): Promise<'not_found' | 'archived' | null> {
  const cat = await first<{ archived_at: string | null }>(c, 'SELECT archived_at FROM category WHERE id = ?', id)
  if (!cat) return 'not_found'
  return cat.archived_at === null ? null : 'archived'
}
const categoryGuard = (w: WriteBatch, id: number) =>
  w.guard('EXISTS (SELECT 1 FROM category WHERE id = ? AND archived_at IS NULL)', [id], 'archived')

function versionValues(v: NewVersion): Record<string, Value> {
  return {
    category_id: v.categoryId,
    amount_cents: v.amountCents,
    start_month: v.startMonth,
    end_month: v.endMonth,
    rhythm: v.rhythm.kind,
    every_n: v.rhythm.kind === 'every_n' ? v.rhythm.everyN : null,
    anchor_month: v.rhythm.kind === 'every_n' ? v.rhythm.anchorMonth : null,
    months: v.rhythm.kind === 'months' ? v.rhythm.months.join(',') : null,
  }
}

/** Writes what R3 or R4 worked out: ended versions, replaced ones, removed overrides. */
function applyChange(w: WriteBatch, change: LineChange, now: string): void {
  for (const e of change.endVersions) w.update('budget_line_version', e.id, { end_month: e.endMonth })
  for (const id of change.replaceVersionIds) w.update('budget_line_version', id, { replaced_at: now })
  for (const id of change.removedOverrideIds) w.update('budget_override', id, { removed_at: now })
}

const engineError = (e: LineChangeError) => e.toLowerCase()

export const lines = new Hono<AppEnv>()

lines.post(
  '/api/budget-lines',
  route(async (c) => {
    const b = await readBody(c)
    const label = nameOf(b.label, 'label')
    const categoryId = integer(b.categoryId, 'category', 1, MAX_ID)
    const amount = amountOf(b.amountCents)
    const start = monthIn(b.startMonth, 'month')
    const rhythm = rhythmOf(b.rhythm, false)
    const current = monthOf(serverToday(c).today)
    if (start < current) return fail(c, 422, 'from_month_in_past')
    if (start > lastMonthOf(current)) return fail(c, 422, 'month_too_far')
    // The "every N months" rhythm of a new line starts at its first month (spec 3.6).
    const full: Rhythm = rhythm.kind === 'every_n' ? { kind: 'every_n', everyN: rhythm.everyN, anchorMonth: start } : rhythm
    if (rhythmError(full)) return fail(c, 422, 'invalid_rhythm')
    const closed = await categoryOpen(c, categoryId)
    if (closed === 'not_found') return fail(c, 404, 'not_found')
    if (closed) return fail(c, 422, 'category_archived')

    const w = catalogBatch(c)
    categoryGuard(w, categoryId)
      .insert('budget_line', { label })
      .insert('budget_line_version', {
        budget_line_id: lastInsertedId('budget_line'),
        ...versionValues({ categoryId, amountCents: amount, startMonth: start, endMonth: null, rhythm: full }),
      })
    return respond(c, await w.run())
  }),
)

lines.patch(
  '/api/budget-lines/:id',
  route(async (c) => {
    const id = idParam(c)
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    if (b.label === undefined && b.change === undefined) throw new BadRequest('nothing')
    const label = b.label === undefined ? null : nameOf(b.label, 'label')
    const line = await readLine(c, id)
    if (!line) return fail(c, 404, 'not_found')

    const w = catalogBatch(c).expectVersion('budget_line', id, version)
    if (b.change !== undefined) {
      const ch = (b.change ?? {}) as Record<string, unknown>
      const categoryId = integer(ch.categoryId, 'category', 1, MAX_ID)
      const fromMonth = monthIn(ch.fromMonth, 'month')
      const current = monthOf(serverToday(c).today)
      if (fromMonth > lastMonthOf(current)) return fail(c, 422, 'month_too_far')
      const result = modifyLine({
        versions: line.versions,
        overrides: line.overrides,
        fromMonth,
        currentMonth: current,
        categoryId,
        amountCents: amountOf(ch.amountCents),
        rhythm: rhythmOf(ch.rhythm, true),
      })
      if (!result.ok) return fail(c, 422, engineError(result.error))
      const closed = await categoryOpen(c, categoryId)
      if (closed === 'not_found') return fail(c, 404, 'not_found')
      if (closed) return fail(c, 422, 'category_archived')
      categoryGuard(w, categoryId)
      applyChange(w, result.value, w.now)
      w.insert('budget_line_version', { budget_line_id: id, ...versionValues(result.value.newVersion) })
    }
    // Renaming creates no version (R3); the line's row_version goes up either way.
    if (label !== null) w.update('budget_line', id, { label })
    else w.touch('budget_line', id)
    return respond(c, await w.run())
  }),
)

lines.post(
  '/api/budget-lines/:id/archive',
  route(async (c) => {
    const id = idParam(c)
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    const lastMonth = monthIn(b.lastMonth, 'month')
    const line = await readLine(c, id)
    if (!line) return fail(c, 404, 'not_found')
    const result = archiveLine({ ...line, lastMonth, currentMonth: monthOf(serverToday(c).today) })
    if (!result.ok) return fail(c, 422, engineError(result.error))
    const w = catalogBatch(c).expectVersion('budget_line', id, version)
    applyChange(w, result.value, w.now)
    return respond(c, await w.touch('budget_line', id).run())
  }),
)

/** Checks an override's month: current or later, and a month where the line applies. */
function overrideMonth(c: C, versions: BudgetLineVersion[], month: Month): string | null {
  if (month < monthOf(serverToday(c).today)) return 'month_in_past'
  const applies = versions.some((v) => v.replacedAt === null && versionApplies(v, month))
  return applies ? null : 'not_applicable'
}

lines.post(
  '/api/budget-lines/:id/override',
  route(async (c) => {
    const id = idParam(c)
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    const month = monthIn(b.month, 'month')
    const amount = integer(b.amountCents, 'amount', 0, MAX_CENTS)
    const reason = reasonOf(b.reason)
    const line = await readLine(c, id)
    if (!line) return fail(c, 404, 'not_found')
    const refused = overrideMonth(c, line.versions, month)
    if (refused) return fail(c, 422, refused)
    const w = catalogBatch(c).expectVersion('budget_line', id, version)
    // An override already there is removed, then a new one created (DECISIONS.md, 2026-11-25).
    const active = line.overrides.find((o) => o.month === month && o.removedAt === null)
    if (active) w.update('budget_override', active.id, { removed_at: w.now })
    w.insert('budget_override', { budget_line_id: id, month, amount_cents: amount, reason })
    return respond(c, await w.touch('budget_line', id).run())
  }),
)

lines.post(
  '/api/budget-lines/:id/override/remove',
  route(async (c) => {
    const id = idParam(c)
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    const month = monthIn(b.month, 'month')
    const line = await readLine(c, id)
    if (!line) return fail(c, 404, 'not_found')
    if (month < monthOf(serverToday(c).today)) return fail(c, 422, 'month_in_past')
    const active = line.overrides.find((o) => o.month === month && o.removedAt === null)
    if (!active) return fail(c, 422, 'no_override')
    const w = catalogBatch(c).expectVersion('budget_line', id, version)
    w.update('budget_override', active.id, { removed_at: w.now })
    return respond(c, await w.touch('budget_line', id).run())
  }),
)

