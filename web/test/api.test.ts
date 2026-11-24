import { describe, expect, it, vi } from 'vitest'
import { apiGet, ForbiddenError, OfflineError, SessionExpiredError, type ApiDeps } from '../src/api'
import { sectionFromPath } from '../src/router'

function deps(response: Response | Error, now = 100_000) {
  const store = new Map<string, string>()
  const d: ApiDeps = {
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

describe('sectionFromPath', () => {
  it('maps paths to the four entries, Mois by default', () => {
    expect(sectionFromPath('/')).toBe('mois')
    expect(sectionFromPath('/operations')).toBe('operations')
    expect(sectionFromPath('/projection/2027')).toBe('projection')
    expect(sectionFromPath('/budget')).toBe('budget')
    expect(sectionFromPath('/unknown')).toBe('mois')
  })
})
