// All calls to the Worker go through here: session expiry and lost network
// are handled in one place (spec 4.2).

export class OfflineError extends Error {
  constructor() {
    super('offline')
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('forbidden')
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('session_expired')
  }
}

const RELOAD_MARK = 'plootos.sessionReloadAt'
const RELOAD_GUARD_MS = 15_000

export interface ApiDeps {
  fetch: typeof fetch
  reload: () => void
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  now: () => number
}

function defaultStorage(): ApiDeps['storage'] {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export const browserDeps = (): ApiDeps => ({
  fetch: (...args) => window.fetch(...args),
  reload: () => window.location.reload(),
  storage: defaultStorage(),
  now: () => Date.now(),
})

/**
 * When the Access session has expired, Access answers instead of the Worker
 * (a redirect to its login page, or its own page). Reloading the page sends the
 * person back through Access. A guard stops a reload loop.
 */
function handleExpiredSession(deps: ApiDeps): never {
  let last = 0
  try {
    last = Number(deps.storage?.getItem(RELOAD_MARK) ?? 0)
  } catch {
    last = 0
  }
  const now = deps.now()
  if (now - last > RELOAD_GUARD_MS) {
    try {
      deps.storage?.setItem(RELOAD_MARK, String(now))
    } catch {
      // Storage unavailable: reload anyway.
    }
    deps.reload()
  }
  throw new SessionExpiredError()
}

export async function apiGet<T>(path: string, deps: ApiDeps = browserDeps()): Promise<T> {
  let res: Response
  try {
    res = await deps.fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new OfflineError()
  }

  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.status === 401) {
    handleExpiredSession(deps)
  }
  if (res.status === 403) throw new ForbiddenError()
  if (!res.ok) throw new Error(`http_${res.status}`)

  const type = res.headers.get('Content-Type') ?? ''
  if (!type.includes('application/json')) {
    // An HTML page where JSON was expected: Access's login page.
    handleExpiredSession(deps)
  }
  return (await res.json()) as T
}
