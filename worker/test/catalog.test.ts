// Lot 7: setup, sections, categories, order, opening balance (spec 3.7, 3.8, R4, R10).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  API_VERSION,
  API_VERSION_HEADER,
  SIMULATED_TODAY_HEADER,
  type BaseResponse,
  type NewCategoryRequest,
} from '../../shared/src/api'
import { assemble, decodeData } from '../../shared/src/wire'
import { exampleSeedInput } from '../../shared/fixtures/example'
import { seedSql, toSeed } from '../../shared/fixtures/seed'
import { createApp } from '../src/app'
import type { Bindings } from '../src/types'
import { runSql, testDb, type TestDb } from './d1'

const P1 = 'p1@example.test'
const P2 = 'p2@example.test'
const BASE = 'http://localhost:8787'
const app = createApp()
let t: TestDb
beforeAll(async () => {
  t = await testDb()
}, 60_000)
afterAll(async () => t?.dispose())

const env = (email = P1): Bindings => ({
  ASSETS: { fetch: async () => new Response('x') } as unknown as Fetcher,
  DB: t.db,
  ENVIRONMENT: 'local',
  ALLOWED_USERS: JSON.stringify({ [P1]: 'Alice', [P2]: 'Bob' }),
  DEV_AUTH_EMAIL: email,
})

/** Simulated today: 15/03/2027, so the opening balance is dated 28/02/2027 (spec 1.3). */
const headers = (today = '2027-03-15'): Record<string, string> => ({
  [API_VERSION_HEADER]: String(API_VERSION),
  [SIMULATED_TODAY_HEADER]: today,
  Origin: BASE,
  'Content-Type': 'application/json',
})
async function send(method: string, path: string, body?: unknown, who = P1, today?: string) {
  const res = await app.request(`${BASE}${path}`, { method, headers: headers(today), body: body === undefined ? undefined : JSON.stringify(body) }, env(who))
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
const post = (path: string, body: unknown, who = P1, today?: string) => send('POST', path, body, who, today)
const patch = (path: string, body: unknown, who = P1) => send('PATCH', path, body, who)

async function load() {
  const res = await app.request(`${BASE}/api/data`, { headers: { [API_VERSION_HEADER]: String(API_VERSION), [SIMULATED_TODAY_HEADER]: '2027-03-15' } }, env())
  const base = (await res.json()) as BaseResponse
  return decodeData(assemble(base, []))
}
const secId = async (name: string) => (await load()).sections.find((s) => s.name === name)!.id
const catByName = async (name: string, parent: string | null = null) => {
  const d = await load()
  const p = parent === null ? null : d.categories.find((c) => c.name === parent && c.parentId === null)!.id
  return d.categories.find((c) => c.name === name && c.parentId === p)!
}

describe('setup (spec 3.8)', () => {
  beforeEach(async () => t.reset())

  it('writes the opening balance, dated the last day of the previous month, and six sections', async () => {
    const out = await post('/api/setup', { amountCents: 300000 }, P2)
    expect(out.status).toBe(200)
    const d = await load()
    expect(d.openingBalance).toMatchObject({ balanceDate: '2027-02-28', amountCents: 300000, createdBy: 'Bob' })
    expect(d.sections.map((s) => [s.name, s.direction, s.sortOrder])).toEqual([
      ['Revenus réguliers', 'in', 0],
      ['Revenus ponctuels', 'in', 1],
      ['Dépenses fixes', 'out', 2],
      ['Dépenses courantes', 'out', 3],
      ['Dépenses ponctuelles', 'out', 4],
      ['Épargne', 'out', 5],
    ])
  })

  it('takes the month before, on any day, including the first of January', async () => {
    await post('/api/setup', { amountCents: 0 }, P1, '2027-01-01')
    expect((await load()).openingBalance?.balanceDate).toBe('2026-12-31')
  })

  it('accepts a negative balance, refuses a non-integer one, and a second setup', async () => {
    expect((await post('/api/setup', { amountCents: 12.5 })).status).toBe(400)
    expect((await post('/api/setup', { amountCents: '3000' })).status).toBe(400)
    expect((await post('/api/setup', { amountCents: -45000 })).status).toBe(200)
    expect(await post('/api/setup', { amountCents: 1 })).toEqual({ status: 422, body: { error: 'already_set_up' } })
    expect((await load()).openingBalance?.amountCents).toBe(-45000)
  })

  it('refuses when the database already holds data', async () => {
    await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
    await t.db.prepare('DELETE FROM opening_balance').run()
    expect((await post('/api/setup', { amountCents: 1 })).body).toEqual({ error: 'already_set_up' })
  })

  it('refuses every catalog write before the setup', async () => {
    expect(await post('/api/sections', { name: 'A', direction: 'in' })).toEqual({ status: 422, body: { error: 'not_set_up' } })
  })

  it('changes the amount of the opening balance, never its date', async () => {
    await post('/api/setup', { amountCents: 300000 })
    expect((await patch('/api/opening-balance', { rowVersion: 1, amountCents: 310000 }, P2)).status).toBe(200)
    expect((await load()).openingBalance).toMatchObject({ balanceDate: '2027-02-28', amountCents: 310000, rowVersion: 2, updatedBy: 'Bob' })
    const stale = await patch('/api/opening-balance', { rowVersion: 1, amountCents: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toBe('conflict')
  })
})

describe('sections and categories', () => {
  beforeEach(async () => {
    await t.reset()
    await post('/api/setup', { amountCents: 300000 })
  })

  it('creates a section at the end, refuses a name already taken (any case)', async () => {
    expect((await post('/api/sections', { name: '  Loisirs ', direction: 'out' })).status).toBe(200)
    const d = await load()
    expect(d.sections.at(-1)).toMatchObject({ name: 'Loisirs', direction: 'out', sortOrder: 6 })
    expect(await post('/api/sections', { name: 'loisirs', direction: 'in' })).toEqual({ status: 422, body: { error: 'name_taken' } })
    expect((await post('/api/sections', { name: '', direction: 'in' })).status).toBe(400)
    expect((await post('/api/sections', { name: 'x'.repeat(201), direction: 'in' })).status).toBe(400)
    expect((await post('/api/sections', { name: 'Z', direction: 'both' })).status).toBe(400)
  })

  it('renames a section, never changes its direction', async () => {
    const id = await secId('Épargne')
    expect((await patch(`/api/sections/${id}`, { rowVersion: 1, name: 'Mises de côté' })).status).toBe(200)
    expect((await load()).sections.find((s) => s.id === id)).toMatchObject({ name: 'Mises de côté', direction: 'out', rowVersion: 2 })
    expect((await patch(`/api/sections/${id}`, { rowVersion: 2, name: 'X', direction: 'in' })).status).toBe(200)
    expect((await load()).sections.find((s) => s.id === id)?.direction).toBe('out')
    expect((await patch(`/api/sections/${id}`, { rowVersion: 1, name: 'Vieux' })).status).toBe(409)
  })

  it('creates categories and subcategories; the first subcategory asks for confirmation (R10)', async () => {
    const fixed = await secId('Dépenses fixes')
    expect((await post('/api/categories', { name: 'Assurance', sectionId: fixed })).status).toBe(200)
    expect((await post('/api/categories', { name: 'assurance', sectionId: fixed })).body).toEqual({ error: 'name_taken' })
    const parent = (await catByName('Assurance')).id
    const body = { name: 'Auto', parentId: parent } satisfies NewCategoryRequest
    expect(await post('/api/categories', body)).toEqual({ status: 422, body: { error: 'confirmation_required' } })
    expect((await post('/api/categories', { ...body, confirmFirstSub: true })).status).toBe(200)
    // The second one needs no confirmation.
    expect((await post('/api/categories', { name: 'Maison', parentId: parent })).status).toBe(200)
    expect((await post('/api/categories', { name: 'MAISON', parentId: parent })).body).toEqual({ error: 'name_taken' })
    const d = await load()
    const subs = d.categories.filter((c) => c.parentId === parent)
    expect(subs.map((c) => [c.name, c.sectionId, c.sortOrder])).toEqual([['Auto', null, 0], ['Maison', null, 1]])
    // A subcategory has no subcategory.
    const auto = (await catByName('Auto', 'Assurance')).id
    expect((await post('/api/categories', { name: 'Neuf', parentId: auto, confirmFirstSub: true })).body).toEqual({ error: 'not_level_one' })
    // The same name is fine under another parent.
    const other = await post('/api/categories', { name: 'Autre', sectionId: fixed })
    expect(other.status).toBe(200)
    expect((await post('/api/categories', { name: 'Auto', parentId: (other.body.ids as number[])[0], confirmFirstSub: true })).status).toBe(200)
  })

  it('refuses a category without a parent or with two, and in a missing or archived section', async () => {
    expect((await post('/api/categories', { name: 'X' })).status).toBe(400)
    expect((await post('/api/categories', { name: 'X', sectionId: 1, parentId: 1 })).status).toBe(400)
    expect((await post('/api/categories', { name: 'X', sectionId: 999 })).status).toBe(404)
    const id = await secId('Épargne')
    await post(`/api/sections/${id}/archive`, { rowVersion: 1 })
    expect((await post('/api/categories', { name: 'X', sectionId: id })).body).toEqual({ error: 'archived' })
  })

  it('moves a category to a section of the same direction only, at the end (R10)', async () => {
    const fixed = await secId('Dépenses fixes')
    const everyday = await secId('Dépenses courantes')
    const income = await secId('Revenus réguliers')
    await post('/api/categories', { name: 'Logement', sectionId: fixed })
    await post('/api/categories', { name: 'Courses', sectionId: everyday })
    const logement = await catByName('Logement')
    expect((await patch(`/api/categories/${logement.id}`, { rowVersion: 1, sectionId: income })).body).toEqual({ error: 'direction_differs' })
    expect((await patch(`/api/categories/${logement.id}`, { rowVersion: 1, sectionId: everyday })).status).toBe(200)
    expect(await catByName('Logement')).toMatchObject({ sectionId: everyday, sortOrder: 1, rowVersion: 2 })
  })

  it('renames, keeps a subcategory under its parent, refuses a name already taken in the target', async () => {
    const fixed = await secId('Dépenses fixes')
    const everyday = await secId('Dépenses courantes')
    await post('/api/categories', { name: 'Énergie', sectionId: fixed })
    await post('/api/categories', { name: 'Énergie', sectionId: everyday })
    const e1 = (await load()).categories.find((c) => c.sectionId === fixed)!
    expect((await patch(`/api/categories/${e1.id}`, { rowVersion: 1, sectionId: everyday })).body).toEqual({ error: 'name_taken' })
    expect((await patch(`/api/categories/${e1.id}`, { rowVersion: 1, name: 'énergie' })).status).toBe(200)
    await post('/api/categories', { name: 'Gaz', parentId: e1.id, confirmFirstSub: true })
    const gaz = await catByName('Gaz', 'énergie')
    expect((await patch(`/api/categories/${gaz.id}`, { rowVersion: 1, sectionId: everyday })).body).toEqual({ error: 'parent_fixed' })
    expect((await patch(`/api/categories/${gaz.id}`, { rowVersion: 1 })).status).toBe(400)
  })
})

describe('archiving (R4)', () => {
  beforeEach(async () => {
    await t.reset()
    await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
  })

  it('refuses a section or a category with an active line, subcategories included', async () => {
    const d = await load()
    const everyday = d.sections.find((s) => s.name === 'Dépenses courantes')!
    expect(await post(`/api/sections/${everyday.id}/archive`, { rowVersion: everyday.rowVersion })).toEqual({ status: 422, body: { error: 'has_active_line' } })
    const courses = d.categories.find((c) => c.name === 'Courses')!
    expect((await post(`/api/categories/${courses.id}/archive`, { rowVersion: courses.rowVersion })).body).toEqual({ error: 'has_active_line' })
    // The line of "Chats" is on a subcategory only: archiving that subcategory is refused too.
    const chats = d.categories.find((c) => c.name === 'Chats')!
    expect((await post(`/api/categories/${chats.id}/archive`, { rowVersion: chats.rowVersion })).body).toEqual({ error: 'has_active_line' })
    expect((await load()).categories.every((c) => c.archivedAt === null)).toBe(true)
  })

  it('archives a category without a line, and its subcategories with it', async () => {
    const d = await load()
    const health = d.categories.find((c) => c.name === 'Santé')!
    const out = await post(`/api/categories/${health.id}/archive`, { rowVersion: health.rowVersion }, P2)
    expect(out.status).toBe(200)
    const after = await load()
    const pharmacy = after.categories.find((c) => c.name === 'Pharmacie')!
    expect(after.categories.find((c) => c.id === health.id)?.archivedAt).not.toBeNull()
    expect(pharmacy).toMatchObject({ rowVersion: 2, updatedBy: 'Bob' })
    expect(pharmacy.archivedAt).not.toBeNull()
    expect((await post(`/api/categories/${health.id}/archive`, { rowVersion: 2 })).body).toEqual({ error: 'archived' })
  })

  it('lets a line that ended in a past month go: it is no longer active', async () => {
    const d = await load()
    const energy = d.categories.find((c) => c.name === 'Énergie')!
    await t.db.prepare("UPDATE budget_line_version SET end_month = '2027-04' WHERE category_id = ?").bind(energy.id).run()
    // Today is in May 2027: April is past.
    expect((await post(`/api/categories/${energy.id}/archive`, { rowVersion: energy.rowVersion }, P1, '2027-05-10')).status).toBe(200)
    // Ending in the current month or later still counts.
    const car = d.categories.find((c) => c.name === 'Auto')!
    await t.db.prepare("UPDATE budget_line_version SET end_month = '2027-05' WHERE category_id = ?").bind(car.id).run()
    expect((await post(`/api/categories/${car.id}/archive`, { rowVersion: car.rowVersion }, P1, '2027-05-10')).body).toEqual({ error: 'has_active_line' })
    // A replaced version never counts.
    await t.db.prepare("UPDATE budget_line_version SET replaced_at = '2027-03-01T00:00:00Z' WHERE category_id = ?").bind(car.id).run()
    expect((await post(`/api/categories/${car.id}/archive`, { rowVersion: car.rowVersion }, P1, '2027-05-10')).status).toBe(200)
  })

  it('archives a section without line, with all its categories and subcategories', async () => {
    const d = await load()
    const oneOff = d.sections.find((s) => s.name === 'Dépenses ponctuelles')!
    await post('/api/categories', { name: 'Voiture', sectionId: oneOff.id })
    await post('/api/categories', { name: 'Pneus', parentId: (await catByName('Voiture')).id, confirmFirstSub: true })
    expect((await post(`/api/sections/${oneOff.id}/archive`, { rowVersion: oneOff.rowVersion })).status).toBe(200)
    const after = await load()
    expect(after.sections.find((s) => s.id === oneOff.id)?.archivedAt).not.toBeNull()
    expect(after.categories.filter((c) => c.name === 'Voiture' || c.name === 'Pneus').every((c) => c.archivedAt !== null)).toBe(true)
    // An archived section can no longer be renamed.
    expect((await patch(`/api/sections/${oneOff.id}`, { rowVersion: 2, name: 'Z' })).body).toEqual({ error: 'archived' })
  })

  it('refuses with a stale version, and writes nothing', async () => {
    const d = await load()
    const health = d.categories.find((c) => c.name === 'Santé')!
    await patch(`/api/categories/${health.id}`, { rowVersion: 1, name: 'Santé et soins' }, P2)
    const out = await post(`/api/categories/${health.id}/archive`, { rowVersion: 1 })
    expect(out).toEqual({ status: 409, body: { error: 'conflict', changed: [{ table: 'category', id: health.id }] } })
    expect((await load()).categories.filter((c) => c.archivedAt !== null)).toEqual([])
  })
})

describe('order', () => {
  beforeEach(async () => {
    await t.reset()
    await post('/api/setup', { amountCents: 0 })
  })

  it('saves the whole group in its new order; only changed rows are written', async () => {
    const d = await load()
    const [a, b, c, ...rest] = d.sections
    const items = [b!, a!, c!, ...rest].map((s) => ({ id: s.id, rowVersion: s.rowVersion }))
    expect((await post('/api/order', { kind: 'section', items }, P2)).status).toBe(200)
    const after = await load()
    expect(after.sections.slice().sort((x, y) => x.sortOrder - y.sortOrder).map((s) => s.name).slice(0, 3)).toEqual([b!.name, a!.name, c!.name])
    expect(after.sections.find((s) => s.id === c!.id)?.rowVersion).toBe(1)
    expect(after.sections.find((s) => s.id === a!.id)).toMatchObject({ rowVersion: 2, updatedBy: 'Bob' })
  })

  it('orders the categories of a section and the subcategories of a category', async () => {
    const fixed = await secId('Dépenses fixes')
    for (const n of ['A', 'B', 'C']) await post('/api/categories', { name: n, sectionId: fixed })
    const cats = (await load()).categories
    const items = [...cats].reverse().map((x) => ({ id: x.id, rowVersion: x.rowVersion }))
    expect((await post('/api/order', { kind: 'category', group: { sectionId: fixed }, items })).status).toBe(200)
    expect((await load()).categories.slice().sort((x, y) => x.sortOrder - y.sortOrder).map((x) => x.name)).toEqual(['C', 'B', 'A'])
    const a = await catByName('A')
    for (const n of ['x', 'y']) await post('/api/categories', { name: n, parentId: a.id, confirmFirstSub: true })
    const subs = (await load()).categories.filter((x) => x.parentId === a.id)
    const swapped = [subs[1]!, subs[0]!].map((x) => ({ id: x.id, rowVersion: x.rowVersion }))
    expect((await post('/api/order', { kind: 'category', group: { parentId: a.id }, items: swapped })).status).toBe(200)
    expect((await load()).categories.filter((x) => x.parentId === a.id).sort((x, y) => x.sortOrder - y.sortOrder).map((x) => x.name)).toEqual(['y', 'x'])
  })

  it('answers "modifié entre-temps" when the group changed or an element is stale', async () => {
    const d = await load()
    const items = d.sections.map((s) => ({ id: s.id, rowVersion: s.rowVersion })).reverse()
    await post('/api/sections', { name: 'Nouvelle', direction: 'out' }, P2)
    expect((await post('/api/order', { kind: 'section', items })).body).toEqual({ error: 'conflict', changed: [] })
    const fresh = (await load()).sections
    await patch(`/api/sections/${fresh[0]!.id}`, { rowVersion: 1, name: 'Renommée' }, P2)
    const stale = await post('/api/order', { kind: 'section', items: fresh.map((s) => ({ id: s.id, rowVersion: s.rowVersion })).reverse() })
    expect(stale.status).toBe(409)
    expect((await load()).sections.every((s, i) => s.sortOrder === (fresh[i] as { sortOrder: number }).sortOrder)).toBe(true)
  })

  it('refuses a malformed request', async () => {
    for (const bad of [{ kind: 'x', items: [] }, { kind: 'section', items: [] }, { kind: 'category', items: [{ id: 1, rowVersion: 1 }] }, { kind: 'section', items: [{ id: 1, rowVersion: 1 }, { id: 1, rowVersion: 1 }] }]) {
      expect((await post('/api/order', bad)).status).toBe(400)
    }
  })
})

describe('recreating the categories of the example month (lot criterion)', () => {
  it('gives the sections and categories of spec 1.3 from an empty database', async () => {
    await t.reset()
    expect((await post('/api/setup', { amountCents: 300000 })).status).toBe(200)
    const tree: [string, string[]][] = [
      ['Revenus réguliers', ['Salaires>Personne 1', 'Salaires>Personne 2']],
      ['Dépenses fixes', ['Logement', 'Énergie', 'Garde des enfants', 'Assurance>Auto', 'Assurance>Maison']],
      ['Dépenses courantes', ['Courses>Supermarché', 'Courses>Boucherie', 'Courses>Chats', 'Santé>Pharmacie']],
      ['Épargne', ['Livret A']],
    ]
    for (const [section, entries] of tree) {
      const sectionId = await secId(section)
      for (const entry of entries) {
        const [top, sub] = entry.split('>') as [string, string | undefined]
        const existing = (await load()).categories.find((c) => c.name === top && c.parentId === null)
        const parent = existing ?? { id: ((await post('/api/categories', { name: top, sectionId })).body.ids as number[])[0]! }
        if (sub) await post('/api/categories', { name: sub, parentId: parent.id, confirmFirstSub: true })
      }
    }
    const { exampleSeedInput: example } = await import('../../shared/fixtures/example')
    const expected = example().data
    const d = await load()
    const path = (id: number, list: { id: number; name: string; parentId: number | null }[]) => {
      const c = list.find((x) => x.id === id)!
      return c.parentId === null ? c.name : `${list.find((x) => x.id === c.parentId)!.name}>${c.name}`
    }
    const shape = (cs: { id: number; name: string; parentId: number | null; sectionId: number | null }[], ss: { id: number; name: string; direction: string }[]) =>
      cs
        .map((c) => {
          const top = c.parentId === null ? c : cs.find((x) => x.id === c.parentId)!
          const s = ss.find((x) => x.id === top.sectionId)!
          return `${s.name} (${s.direction}) / ${path(c.id, cs)}`
        })
        .sort()
    expect(shape(d.categories, d.sections)).toEqual(shape(expected.categories, expected.sections.filter((s) => expected.categories.some((c) => c.sectionId === s.id))))
  })
})
