// Writes of lot 7 (spec 3.7, 3.8, 4.3): setup, sections, categories, their order, the opening
// balance. Every route reads what it needs to answer clearly, then writes one all-or-nothing
// batch whose guards check the rules again at write time (R4, R10, "Modifié entre-temps").

import { Hono } from 'hono'
import { INITIAL_SECTIONS, type ApiError } from '../../shared/src/api'
import { addMonths, lastDayOfMonth, monthOf } from '../../shared/src/engine/dates'
import { all, BadRequest, catalogBatch, fail, first, idParam, integer, MAX_CENTS, nameOf, readBody, respond, route, rowVersion, type C } from './request'
import { serverToday } from './today'
import type { AppEnv } from './types'
import { SqlValue, WriteBatch, type Value } from './write'

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** True when no row of `siblings` (name, id) has this name, ignoring case, other than `selfId`. */
const nameFree = (siblings: { id: number; name: string }[], name: string, selfId: number | null) =>
  !siblings.some((s) => s.id !== selfId && sameName(s.name, name))

/**
 * R4: no active line in the categories matched by `condition` (on alias c). A line is active
 * when a version that is not replaced has no end, or ends in the current month or later.
 */
const noActiveLine = (condition: string) =>
  `NOT EXISTS (SELECT 1 FROM budget_line_version v WHERE v.replaced_at IS NULL ` +
  `AND (v.end_month IS NULL OR v.end_month >= ?) AND v.category_id IN (SELECT c.id FROM category c WHERE ${condition}))`

interface SectionRow {
  id: number
  name: string
  direction: 'in' | 'out'
  archived_at: string | null
}
interface CategoryRow {
  id: number
  name: string
  parent_id: number | null
  section_id: number | null
  archived_at: string | null
}

export const catalog = new Hono<AppEnv>()

// Setup (spec 3.8): the opening balance and the six initial sections, only on an empty database
// (no data outside meta; also the condition of a restore).
export const EMPTY =
  'NOT EXISTS (SELECT 1 FROM opening_balance) AND NOT EXISTS (SELECT 1 FROM section) AND ' +
  'NOT EXISTS (SELECT 1 FROM category) AND NOT EXISTS (SELECT 1 FROM budget_line) AND ' +
  'NOT EXISTS (SELECT 1 FROM operation) AND NOT EXISTS (SELECT 1 FROM balance_check)'

catalog.post(
  '/api/setup',
  route(async (c) => {
    const b = await readBody(c)
    const amount = integer(b.amountCents, 'amount', -MAX_CENTS, MAX_CENTS)
    // The date is fixed by the app: the last day of the month before today (spec 3.8).
    const date = lastDayOfMonth(addMonths(monthOf(serverToday(c).today), -1))
    const w = new WriteBatch(c.env.DB, c.get('user').email).guard(EMPTY, [], 'already_set_up')
    w.insert('opening_balance', { id: 1, balance_date: date, amount_cents: amount })
    INITIAL_SECTIONS.forEach(([name, direction], i) => w.insert('section', { name, direction, sort_order: i }))
    return respond(c, await w.run())
  }),
)

catalog.patch(
  '/api/opening-balance',
  route(async (c) => {
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    const amount = integer(b.amountCents, 'amount', -MAX_CENTS, MAX_CENTS)
    if (!(await first(c, 'SELECT 1 FROM opening_balance WHERE id = 1'))) return fail(c, 404, 'not_found')
    const w = catalogBatch(c).expectVersion('opening_balance', 1, version)
    return respond(c, await w.update('opening_balance', 1, { amount_cents: amount }).run())
  }),
)

// Sections

const sections = (c: C) => all<SectionRow>(c, 'SELECT id, name, direction, archived_at FROM section ORDER BY sort_order, id')

catalog.post(
  '/api/sections',
  route(async (c) => {
    const b = await readBody(c)
    const name = nameOf(b.name)
    if (b.direction !== 'in' && b.direction !== 'out') throw new BadRequest('direction')
    const live = (await sections(c)).filter((s) => s.archived_at === null)
    if (!nameFree(live, name, null)) return fail(c, 422, 'name_taken')
    const w = catalogBatch(c).guard('NOT EXISTS (SELECT 1 FROM section WHERE archived_at IS NULL AND name = ?)', [name], 'name_taken')
    w.insert('section', {
      name,
      direction: b.direction,
      sort_order: nextOrder('section'),
    })
    return respond(c, await w.run())
  }),
)

/** Next sort_order of a group: the end of the list. */
const nextOrder = (table: 'section' | 'category', where = '1 = 1', params: unknown[] = []) =>
  new SqlValue(`(SELECT COALESCE(max(sort_order), -1) + 1 FROM ${table} WHERE ${where})`, params)

catalog.patch(
  '/api/sections/:id',
  route(async (c) => {
    const id = idParam(c)
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    const name = nameOf(b.name)
    const allSections = await sections(c)
    const section = allSections.find((s) => s.id === id)
    if (!section) return fail(c, 404, 'not_found')
    if (section.archived_at !== null) return fail(c, 422, 'archived')
    if (!nameFree(allSections.filter((s) => s.archived_at === null), name, id)) return fail(c, 422, 'name_taken')
    const w = catalogBatch(c)
      .expectVersion('section', id, version)
      .guard('NOT EXISTS (SELECT 1 FROM section WHERE archived_at IS NULL AND name = ? AND id <> ?)', [name, id], 'name_taken')
      .guard('EXISTS (SELECT 1 FROM section WHERE id = ? AND archived_at IS NULL)', [id], 'archived')
    return respond(c, await w.update('section', id, { name }).run())
  }),
)

catalog.post(
  '/api/sections/:id/archive',
  route(async (c) => {
    const id = idParam(c)
    const version = rowVersion((await readBody(c)).rowVersion)
    const section = (await sections(c)).find((s) => s.id === id)
    if (!section) return fail(c, 404, 'not_found')
    if (section.archived_at !== null) return fail(c, 422, 'archived')
    const month = monthOf(serverToday(c).today)
    const inSection = 'c.section_id = ? OR c.parent_id IN (SELECT id FROM category WHERE section_id = ?)'
    const now = new Date().toISOString()
    const w = catalogBatch(c)
      .expectVersion('section', id, version)
      .guard(noActiveLine(inSection), [month, id, id], 'has_active_line')
      .update('section', id, { archived_at: now })
      .archiveWhere('category', 'section_id = ? OR parent_id IN (SELECT id FROM category WHERE section_id = ?)', [id, id])
    return respond(c, await w.run())
  }),
)

// Categories

const categories = (c: C) =>
  all<CategoryRow>(c, 'SELECT id, name, parent_id, section_id, archived_at FROM category ORDER BY sort_order, id')

catalog.post(
  '/api/categories',
  route(async (c) => {
    const b = await readBody(c)
    const name = nameOf(b.name)
    const hasSection = b.sectionId !== undefined
    const hasParent = b.parentId !== undefined
    if (hasSection === hasParent) throw new BadRequest('parent')
    const cats = (await categories(c)).filter((x) => x.archived_at === null)
    const w = catalogBatch(c)

    if (hasSection) {
      const sectionId = integer(b.sectionId, 'section', 1, 1_000_000_000)
      const section = (await sections(c)).find((s) => s.id === sectionId)
      if (!section) return fail(c, 404, 'not_found')
      if (section.archived_at !== null) return fail(c, 422, 'archived')
      if (!nameFree(cats.filter((x) => x.section_id === sectionId), name, null)) return fail(c, 422, 'name_taken')
      w.guard('EXISTS (SELECT 1 FROM section WHERE id = ? AND archived_at IS NULL)', [sectionId], 'archived')
        .guard('NOT EXISTS (SELECT 1 FROM category WHERE archived_at IS NULL AND section_id = ? AND name = ?)', [sectionId, name], 'name_taken')
        .insert('category', { name, section_id: sectionId, sort_order: nextOrder('category', 'section_id = ?', [sectionId]) })
    } else {
      const parentId = integer(b.parentId, 'parent', 1, 1_000_000_000)
      const parent = (await categories(c)).find((x) => x.id === parentId)
      if (!parent) return fail(c, 404, 'not_found')
      if (parent.parent_id !== null) return fail(c, 422, 'not_level_one')
      if (parent.archived_at !== null) return fail(c, 422, 'archived')
      const subs = cats.filter((x) => x.parent_id === parentId)
      // R10: the first subcategory changes what the category is for: the app asks first.
      if (subs.length === 0 && b.confirmFirstSub !== true) return fail(c, 422, 'confirmation_required')
      if (!nameFree(subs, name, null)) return fail(c, 422, 'name_taken')
      w.guard('EXISTS (SELECT 1 FROM category WHERE id = ? AND parent_id IS NULL AND archived_at IS NULL)', [parentId], 'archived')
        .guard('NOT EXISTS (SELECT 1 FROM category WHERE archived_at IS NULL AND parent_id = ? AND name = ?)', [parentId, name], 'name_taken')
        .insert('category', { name, parent_id: parentId, sort_order: nextOrder('category', 'parent_id = ?', [parentId]) })
    }
    return respond(c, await w.run())
  }),
)

catalog.patch(
  '/api/categories/:id',
  route(async (c) => {
    const id = idParam(c)
    const b = await readBody(c)
    const version = rowVersion(b.rowVersion)
    if (b.name === undefined && b.sectionId === undefined) throw new BadRequest('nothing')
    const cats = await categories(c)
    const cat = cats.find((x) => x.id === id)
    if (!cat) return fail(c, 404, 'not_found')
    if (cat.archived_at !== null) return fail(c, 422, 'archived')
    const name = b.name === undefined ? cat.name : nameOf(b.name)
    const target = b.sectionId === undefined ? null : integer(b.sectionId, 'section', 1, 1_000_000_000)
    const moves = target !== null && target !== cat.section_id
    // R10: a subcategory keeps its parent; a category only moves to a section of the same direction.
    if (target !== null && cat.parent_id !== null) return fail(c, 422, 'parent_fixed')

    const secs = await sections(c)
    const from = secs.find((s) => s.id === cat.section_id)
    const to = moves ? secs.find((s) => s.id === target) : from
    if (!to) return fail(c, 404, 'not_found')
    if (to.archived_at !== null) return fail(c, 422, 'archived')
    if (moves && from && to.direction !== from.direction) return fail(c, 422, 'direction_differs')

    const live = cats.filter((x) => x.archived_at === null)
    const siblings = live.filter((x) => (cat.parent_id !== null ? x.parent_id === cat.parent_id : x.section_id === to.id))
    if (!nameFree(siblings, name, id)) return fail(c, 422, 'name_taken')

    const w = catalogBatch(c)
      .expectVersion('category', id, version)
      .guard('EXISTS (SELECT 1 FROM category WHERE id = ? AND archived_at IS NULL)', [id], 'archived')
    const values: Record<string, Value> = {}
    if (b.name !== undefined) values.name = name
    if (moves) {
      w.guard(
        '(SELECT direction FROM section WHERE id = ? AND archived_at IS NULL) = (SELECT s.direction FROM category c JOIN section s ON s.id = c.section_id WHERE c.id = ?)',
        [to.id, id],
        'direction_differs',
      )
      values.section_id = to.id
      values.sort_order = nextOrder('category', 'section_id = ?', [to.id])
    }
    if (Object.keys(values).length === 0) return respond(c, await w.run())
    const guardName =
      cat.parent_id !== null
        ? ['NOT EXISTS (SELECT 1 FROM category WHERE archived_at IS NULL AND parent_id = ? AND name = ? AND id <> ?)', [cat.parent_id, name, id]]
        : ['NOT EXISTS (SELECT 1 FROM category WHERE archived_at IS NULL AND section_id = ? AND name = ? AND id <> ?)', [to.id, name, id]]
    w.guard(guardName[0] as string, guardName[1] as unknown[], 'name_taken')
    return respond(c, await w.update('category', id, values).run())
  }),
)

catalog.post(
  '/api/categories/:id/archive',
  route(async (c) => {
    const id = idParam(c)
    const version = rowVersion((await readBody(c)).rowVersion)
    const cat = (await categories(c)).find((x) => x.id === id)
    if (!cat) return fail(c, 404, 'not_found')
    if (cat.archived_at !== null) return fail(c, 422, 'archived')
    const month = monthOf(serverToday(c).today)
    const now = new Date().toISOString()
    const w = catalogBatch(c)
      .expectVersion('category', id, version)
      .guard(noActiveLine('c.id = ? OR c.parent_id = ?'), [month, id, id], 'has_active_line')
      .update('category', id, { archived_at: now })
      // A category archived with its subcategories (DECISIONS.md, 2026-11-25).
      .archiveWhere('category', 'parent_id = ?', [id])
    return respond(c, await w.run())
  }),
)

// Order (spec 3.7): the whole group, in its new order.

catalog.post(
  '/api/order',
  route(async (c) => {
    const b = await readBody(c)
    if (b.kind !== 'section' && b.kind !== 'category') throw new BadRequest('kind')
    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 500) throw new BadRequest('items')
    const items = b.items.map((it: unknown) => {
      const o = (it ?? {}) as Record<string, unknown>
      return { id: integer(o.id, 'items', 1, 1_000_000_000), rowVersion: rowVersion(o.rowVersion) }
    })
    if (new Set(items.map((i) => i.id)).size !== items.length) throw new BadRequest('items')

    let table: 'section' | 'category' = 'section'
    let where = 'archived_at IS NULL'
    let params: unknown[] = []
    if (b.kind === 'category') {
      table = 'category'
      const g = (b.group ?? {}) as Record<string, unknown>
      if (g.sectionId !== undefined) {
        where = 'archived_at IS NULL AND section_id = ?'
        params = [integer(g.sectionId, 'group', 1, 1_000_000_000)]
      } else if (g.parentId !== undefined) {
        where = 'archived_at IS NULL AND parent_id = ?'
        params = [integer(g.parentId, 'group', 1, 1_000_000_000)]
      } else throw new BadRequest('group')
    }
    const current = await all<{ id: number; sort_order: number }>(c, `SELECT id, sort_order FROM ${table} WHERE ${where}`, ...params)
    const known = new Set(current.map((r) => r.id))
    // The group changed meanwhile (an element added or archived): the app reloads and tries again.
    if (known.size !== items.length || !items.every((i) => known.has(i.id))) {
      return c.json({ error: 'conflict', changed: [] } satisfies ApiError, 409)
    }
    const was = new Map(current.map((r) => [r.id, r.sort_order]))
    const w = catalogBatch(c).guard(`(SELECT count(*) FROM ${table} WHERE ${where}) = ?`, [...params, items.length], 'conflict')
    items.forEach((it) => w.expectVersion(table, it.id, it.rowVersion))
    items.forEach((it, index) => {
      if (was.get(it.id) !== index) w.update(table, it.id, { sort_order: index })
    })
    return respond(c, await w.run())
  }),
)
