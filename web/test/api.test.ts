import { describe, expect, it, vi } from 'vitest'
import { API_VERSION_HEADER, SIMULATED_TODAY_HEADER } from '../../shared/src/api'
import { exampleSeedInput } from '../../shared/fixtures/example'
import { EMPTY_SEED, seedPages, toSeed } from '../../shared/fixtures/seed'
import type { BaseResponse, OperationsPageResponse } from '../../shared/src/api'
import {
  apiGet,
  AppOutdatedError,
  ForbiddenError,
  OfflineError,
  SessionExpiredError,
  SIMULATED_TODAY_KEY,
  type ApiDeps,
} from '../src/api'
import { InconsistentDataError, loadData } from '../src/data'
import { sectionFromPath } from '../src/router'

function deps(response: Response | Error, now = 100_000, settings: Record<string, string> = {}) {
  const store = new Map<string, string>()
  const d: ApiDeps = {
    settings: { getItem: (k) => settings[k] ?? null },
    fetch: vi.fn(async () => {
      if (response instanceof Error) throw response
      return response
    }) as unknown as typeof fetch,
    reload: vi.fn(),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: () => now,
  }
  return { d, store }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function opaqueRedirect(): Response {
  const res = new Response(null, { status: 200 })
  Object.defineProperty(res, 'type', { value: 'opaqueredirect' })
  Object.defineProperty(res, 'status', { value: 0 })
  return res
}

describe('apiGet', () => {
  it('returns the JSON body', async () => {
    const { d } = deps(json({ firstName: 'Alice' }))
    await expect(apiGet('/api/me', d)).resolves.toEqual({ firstName: 'Alice' })
    expect(d.fetch).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ redirect: 'manual', cache: 'no-store', credentials: 'same-origin' }),
    )
  })

  it('reloads the page when Access redirects to its login page (expired session)', async () => {
    const { d } = deps(opaqueRedirect())
    await expect(apiGet('/api/me', d)).rejects.toBeInstanceOf(SessionExpiredError)
    expect(d.reload).toHaveBeenCalledOnce()
  })

  it('reloads the page on 401', async () => {
    const { d } = deps(json({ error: 'unauthenticated' }, 401))
    await expect(apiGet('/api/me', d)).rejects.toBeInstanceOf(SessionExpiredError)
    expect(d.reload).toHaveBeenCalledOnce()
  })

  it('reloads the page when an HTML page comes back instead of JSON', async () => {
    const { d } = deps(new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(apiGet('/api/me', d)).rejects.toBeInstanceOf(SessionExpiredError)
    expect(d.reload).toHaveBeenCalledOnce()
  })

  it('does not reload twice in a row (no loop)', async () => {
    const { d, store } = deps(json({}, 401), 100_000)
    store.set('plootos.sessionReloadAt', String(100_000 - 5_000))
    await expect(apiGet('/api/me', d)).rejects.toBeInstanceOf(SessionExpiredError)
    expect(d.reload).not.toHaveBeenCalled()
  })

  it('reports a lost network', async () => {
    const { d } = deps(new TypeError('NetworkError'))
    await expect(apiGet('/api/me', d)).rejects.toBeInstanceOf(OfflineError)
  })

  it('reports a refused address', async () => {
    const { d } = deps(json({ error: 'forbidden' }, 403))
    await expect(apiGet('/api/me', d)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('headers of every request', () => {
  const sent = (d: ApiDeps) => (d.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]?.[1].headers as Record<string, string>

  it('carry the compatibility number', async () => {
    const { d } = deps(json({}))
    await apiGet('/api/me', d)
    expect(sent(d)[API_VERSION_HEADER]).toBe('2')
    expect(sent(d)[SIMULATED_TODAY_HEADER]).toBeUndefined()
  })

  it('carry the simulated date when one is set on the device', async () => {
    const { d } = deps(json({}), 0, { [SIMULATED_TODAY_KEY]: '2027-03-15' })
    await apiGet('/api/me', d)
    expect(sent(d)[SIMULATED_TODAY_HEADER]).toBe('2027-03-15')
  })

  it('leave out a simulated date that is not a date', async () => {
    const { d } = deps(json({}), 0, { [SIMULATED_TODAY_KEY]: 'demain' })
    await apiGet('/api/me', d)
    expect(sent(d)[SIMULATED_TODAY_HEADER]).toBeUndefined()
  })
})

describe('outdated app (spec 4.8)', () => {
  it('reloads when the server says the app is outdated', async () => {
    const { d } = deps(json({ error: 'app_outdated' }, 409))
    await expect(apiGet('/api/me', d)).rejects.toBeInstanceOf(AppOutdatedError)
    expect(d.reload).toHaveBeenCalledOnce()
  })

  it('does not reload on another refusal', async () => {
    const { d } = deps(json({ error: 'conflict' }, 409))
    await expect(apiGet('/api/me', d)).rejects.toThrow('http_409')
    expect(d.reload).not.toHaveBeenCalled()
  })
})

describe('loadData', () => {
  const users = new Map([['p1@example.test', 'Alice'], ['p2@example.test', 'Bob']])
  const example = () => seedPages(toSeed(exampleSeedInput(), ['p1@example.test', 'p2@example.test']), users, '2027-03-15')

  /** A server answering the base, then each page; `answers` may change the base at each read. */
  function server(base: () => BaseResponse, pages: OperationsPageResponse[]) {
    const { d } = deps(json({}))
    d.fetch = vi.fn(async (url: string) => {
      const m = /^\/api\/data\/operations\/(\d+)$/.exec(url)
      return json(m ? pages[Number(m[1])] : base())
    }) as unknown as typeof fetch
    return d
  }

  it('reads the base, then every page, and computes the example month', async () => {
    const { base, pages } = example()
    let tick = 0
    const loaded = await loadData(server(() => base, pages), () => (tick += 10))
    expect(loaded.app.operations).toHaveLength(13)
    expect(loaded.requests).toBe(2)
    expect(loaded.ledger?.balanceAt('2027-03-15')).toBe(594500)
    expect(loaded.today).toBe('2027-03-15')
    expect(loaded.timings).toEqual({ networkMs: 10, readMs: 10, computeMs: 10, totalMs: 30 })
  })

  it('reads again when a page cites a category the base does not have yet', async () => {
    const { base, pages } = example()
    // First read: the base misses category 31 (created between the base and the page).
    const reads: BaseResponse[] = [
      { ...base, tables: { ...base.tables, category: base.tables.category.filter((r) => r[0] !== 31) } },
      base,
    ]
    let n = 0
    const loaded = await loadData(server(() => reads[Math.min(n++, 1)] as BaseResponse, pages))
    expect(n).toBe(2)
    expect(loaded.app.categories.some((c) => c.id === 31)).toBe(true)
  })

  it('gives up after three inconsistent reads', async () => {
    const { base, pages } = example()
    const broken = { ...base, tables: { ...base.tables, category: base.tables.category.filter((r) => r[0] !== 31) } }
    await expect(loadData(server(() => broken, pages))).rejects.toBeInstanceOf(InconsistentDataError)
  })

  it('has no ledger before the app is set up', async () => {
    const { base, pages } = seedPages(EMPTY_SEED, users, '2027-03-15')
    const loaded = await loadData(server(() => base, pages))
    expect(loaded.ledger).toBeNull()
    expect(loaded.requests).toBe(1)
  })
})

describe('sectionFromPath', () => {
  it('maps paths to the four entries, Mois by default', () => {
    expect(sectionFromPath('/')).toBe('mois')
    expect(sectionFromPath('/operations')).toBe('operations')
    expect(sectionFromPath('/projection/2027')).toBe('projection')
    expect(sectionFromPath('/budget')).toBe('budget')
    expect(sectionFromPath('/unknown')).toBe('mois')
  })
})
