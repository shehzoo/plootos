// Lot 7: the categories view, the euro field, the write call, the tabs of Budget.

import { describe, expect, it, vi } from 'vitest'
import { exampleSeedInput } from '../../shared/fixtures/example'
import { toSeed } from '../../shared/fixtures/seed'
import { API_VERSION_HEADER } from '../../shared/src/api'
import { assemble, decodeData } from '../../shared/src/wire'
import { seedPages } from '../../shared/fixtures/seed'
import { apiSend, AppOutdatedError, ConflictError, OfflineError, RuleError, SessionExpiredError, type ApiDeps } from '../src/api'
import { activeLinesByCategory, catalogView, ruleText } from '../src/budget/catalog'
import { messageOf } from '../src/budget/write'
import { parseEuros } from '../src/format'
import { budgetTabPath, placeFromLocation } from '../src/router'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function deps(response: Response | Error) {
  const store = new Map<string, string>()
  const d: ApiDeps = {
    settings: { getItem: () => null },
    fetch: vi.fn(async () => {
      if (response instanceof Error) throw response
      return response
    }) as unknown as typeof fetch,
    reload: vi.fn(),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => 100_000,
  }
  return d
}

describe('parseEuros', () => {
  it('reads what a person types', () => {
    expect(parseEuros('3000')).toBe(300000)
    expect(parseEuros('3 000,50')).toBe(300050)
    expect(parseEuros('3 000 €')).toBe(300000)
    expect(parseEuros('-45.2')).toBe(-4520)
    expect(parseEuros('−12')).toBe(-1200)
    expect(parseEuros('0')).toBe(0)
  })
  it('refuses what is not an amount in euros', () => {
    for (const bad of ['', 'abc', '1,234', '12.345', '1e3', '--1', '1 2 3 4 5 6 7 8 9 0']) expect(parseEuros(bad)).toBeNull()
  })
})

describe('apiSend', () => {
  it('sends JSON and returns the ids', async () => {
    const d = deps(json({ ok: true, ids: [7] }))
    await expect(apiSend('POST', '/api/sections', { name: 'A' }, d)).resolves.toEqual({ ok: true, ids: [7] })
    const [path, init] = (d.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/sections')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'manual', body: '{"name":"A"}' })
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[API_VERSION_HEADER]).toBeDefined()
  })
  it('throws a conflict with the elements that changed', async () => {
    const d = deps(json({ error: 'conflict', changed: [{ table: 'category', id: 3 }] }, 409))
    const error = await apiSend('PATCH', '/api/categories/3', {}, d).catch((e) => e)
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.changed).toEqual([{ table: 'category', id: 3 }])
  })
  it('throws the code of a refused rule', async () => {
    const error = await apiSend('POST', '/api/sections', {}, deps(json({ error: 'name_taken' }, 422))).catch((e) => e)
    expect(error).toBeInstanceOf(RuleError)
    expect(error).toMatchObject({ code: 'name_taken', status: 422 })
  })
  it('reloads for an outdated app and for an expired session', async () => {
    const outdated = deps(json({ error: 'app_outdated' }, 409))
    await expect(apiSend('POST', '/x', {}, outdated)).rejects.toBeInstanceOf(AppOutdatedError)
    expect(outdated.reload).toHaveBeenCalledOnce()
    const expired = deps(new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    await expect(apiSend('POST', '/x', {}, expired)).rejects.toBeInstanceOf(SessionExpiredError)
    expect(expired.reload).toHaveBeenCalledOnce()
  })
  it('says so when the network is lost', async () => {
    await expect(apiSend('POST', '/x', {}, deps(new TypeError('failed')))).rejects.toBeInstanceOf(OfflineError)
  })
})

describe('messages', () => {
  it('explains each kind of failure in French, never with a value', () => {
    expect(messageOf(new ConflictError([])).kind).toBe('conflict')
    expect(messageOf(new ConflictError([])).text).toContain('Modifié entre-temps')
    expect(messageOf(new RuleError('name_taken', 422)).text).toBe('Ce nom existe déjà ici.')
    expect(messageOf(new OfflineError()).kind).toBe('error')
    for (const code of ['has_active_line', 'direction_differs', 'parent_fixed', 'archived', 'zzz']) expect(ruleText(code)).not.toBe('')
  })
})

describe('categories view (spec 3.7, R4)', () => {
  const { base, pages } = seedPages(toSeed(exampleSeedInput(), ['p1@example.test', 'p2@example.test']), new Map([['p1@example.test', 'Alice']]), '2027-03-15')
  const app = decodeData(assemble(base, pages))

  it('lists sections, categories and subcategories in their order, with their active lines', () => {
    const tree = catalogView(app, '2027-03')
    expect(tree.map((s) => s.name)).toEqual([
      'Revenus réguliers',
      'Revenus ponctuels',
      'Dépenses fixes',
      'Dépenses courantes',
      'Dépenses ponctuelles',
      'Épargne',
    ])
    const everyday = tree.find((s) => s.name === 'Dépenses courantes')!
    expect(everyday.lines).toBe(2)
    const courses = everyday.categories.find((c) => c.name === 'Courses')!
    expect(courses.subs.map((s) => s.name)).toEqual(['Supermarché', 'Boucherie', 'Chats'])
    // "Courses" has its own line and "Chats" has one: two lines in the category, one in "Chats".
    expect(courses.lines).toBe(2)
    expect(courses.subs.find((s) => s.name === 'Chats')?.lines).toBe(1)
    expect(everyday.categories.find((c) => c.name === 'Santé')?.lines).toBe(0)
    expect(tree.find((s) => s.name === 'Dépenses ponctuelles')?.lines).toBe(0)
  })

  it('leaves archived elements out, and counts a line until its last month has passed', () => {
    const archived = { ...app, categories: app.categories.map((c) => (c.name === 'Santé' || c.name === 'Pharmacie' ? { ...c, archivedAt: 'x' } : c)) }
    const names = catalogView(archived, '2027-03').flatMap((s) => s.categories.map((c) => c.name))
    expect(names).not.toContain('Santé')
    const energy = app.categories.find((c) => c.name === 'Énergie')!
    const ended = (end: string) => ({ ...app, versions: app.versions.map((v) => (v.categoryId === energy.id ? { ...v, endMonth: end } : v)) })
    expect(activeLinesByCategory(ended('2027-04'), '2027-04').get(energy.id)?.size).toBe(1)
    expect(activeLinesByCategory(ended('2027-04'), '2027-05').get(energy.id)).toBeUndefined()
    const replaced = { ...app, versions: app.versions.map((v) => (v.categoryId === energy.id ? { ...v, replacedAt: 'x' } : v)) }
    expect(activeLinesByCategory(replaced, '2027-03').get(energy.id)).toBeUndefined()
  })
})

describe('tabs of Budget', () => {
  it('reads the tab from the path, lines by default', () => {
    expect(placeFromLocation('/budget', '').tab).toBe('lignes')
    expect(placeFromLocation('/budget/2027-05', '').tab).toBe('lignes')
    expect(placeFromLocation('/budget/categories', '')).toMatchObject({ section: 'budget', tab: 'categories', month: null })
    expect(placeFromLocation('/budget/donnees', '').tab).toBe('donnees')
    expect(placeFromLocation('/operations', '').tab).toBe('lignes')
  })
  it('writes the paths back', () => {
    expect(budgetTabPath('lignes')).toBe('/budget')
    expect(budgetTabPath('categories')).toBe('/budget/categories')
    expect(budgetTabPath('donnees')).toBe('/budget/donnees')
  })
})
