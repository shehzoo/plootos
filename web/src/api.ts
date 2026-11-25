// All calls to the Worker go through here: session expiry, lost network and an outdated app
// are handled in one place (spec 4.2, 4.8).

import {
  API_VERSION,
  API_VERSION_HEADER,
  SIMULATED_TODAY_HEADER,
  type ApiError,
  type WriteResult,
} from '../../shared/src/api'

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

export class AppOutdatedError extends Error {
  constructor() {
    super('app_outdated')
  }
}

/**
 * A restore was started and not finished: the server refuses everything until the database is
 * emptied by the GitHub action « Vider la base » (spec 3.8, 4.3).
 */
export class RestoreInProgressError extends Error {
  constructor() {
    super('restore_in_progress')
  }
}

/** A write refused because an element changed meanwhile ("Modifié entre-temps", spec 4.3). */
export class ConflictError extends Error {
  constructor(readonly changed: NonNullable<ApiError['changed']>) {
    super('conflict')
  }
}

/** A write refused by a rule of the server: a fixed code, never a value (spec 4.3). */
export class RuleError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    /** The whole answer, when it carries more than the code (an import whose sort changed). */
    readonly body?: unknown,
  ) {
    super(code)
  }
}

const RELOAD_MARK = 'plootos.sessionReloadAt'
const RELOAD_GUARD_MS = 15_000
/**
 * Simulated "today" ('YYYY-MM-DD'), a test setting kept on the device; the server honours it in
 * local development and staging only. Set by the field at the bottom of the page (lot 5).
 */
export const SIMULATED_TODAY_KEY = 'plootos.simulatedToday'

export interface ApiDeps {
  fetch: typeof fetch
  reload: () => void
  /** Session storage: the reload guard. */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  /** Local storage: display and test settings only, never data (spec 4.5). */
  settings: Pick<Storage, 'getItem'> | null
  now: () => number
}

function safe<T>(get: () => T): T | null {
  try {
    return get()
  } catch {
    return null
  }
}

export const browserDeps = (): ApiDeps => ({
  fetch: (...args) => window.fetch(...args),
  reload: () => window.location.reload(),
  storage: safe(() => window.sessionStorage),
  settings: safe(() => window.localStorage),
  now: () => Date.now(),
})

/** Headers of every API request: the compatibility number, and a simulated date if set. */
export function apiHeaders(deps: Pick<ApiDeps, 'settings'>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', [API_VERSION_HEADER]: String(API_VERSION) }
  const simulated = safe(() => deps.settings?.getItem(SIMULATED_TODAY_KEY) ?? null)
  if (simulated && /^\d{4}-\d{2}-\d{2}$/.test(simulated)) headers[SIMULATED_TODAY_HEADER] = simulated
  return headers
}

/**
 * When the Access session has expired, Access answers instead of the Worker
 * (a redirect to its login page, or its own page). Reloading the page sends the
 * person back through Access. A guard stops a reload loop.
 */
function reloadOnce(deps: ApiDeps): void {
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
}

function handleExpiredSession(deps: ApiDeps): never {
  reloadOnce(deps)
  throw new SessionExpiredError()
}

/** The server runs a newer version: reloading picks up the new app (spec 4.8). */
function handleOutdatedApp(deps: ApiDeps): never {
  reloadOnce(deps)
  throw new AppOutdatedError()
}

/** GET returning the response text, checked; see apiGet. */
export async function apiGetText(path: string, deps: ApiDeps = browserDeps()): Promise<string> {
  let res: Response
  try {
    res = await deps.fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      headers: apiHeaders(deps),
    })
  } catch {
    throw new OfflineError()
  }

  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.status === 401) {
    handleExpiredSession(deps)
  }
  if (res.status === 403) throw new ForbiddenError()
  const refusal = async () => ((await res.clone().json().catch(() => null)) as ApiError | null)?.error
  if (res.status === 409 && (await refusal()) === 'app_outdated') handleOutdatedApp(deps)
  if (res.status === 503 && (await refusal()) === 'restore_in_progress') throw new RestoreInProgressError()
  if (!res.ok) throw new Error(`http_${res.status}`)

  const type = res.headers.get('Content-Type') ?? ''
  if (!type.includes('application/json')) {
    // An HTML page where JSON was expected: Access's login page.
    handleExpiredSession(deps)
  }
  try {
    return await res.text()
  } catch {
    throw new OfflineError()
  }
}

export async function apiGet<T>(path: string, deps: ApiDeps = browserDeps()): Promise<T> {
  return JSON.parse(await apiGetText(path, deps)) as T
}

/**
 * A write: a small JSON request, answered with the ids it inserted. An expired session or an
 * outdated app reloads the page (a write not yet sent is lost, spec 4.2); a conflict or a refused
 * rule is thrown for the screen to explain.
 */
export async function apiSend<T = WriteResult>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  deps: ApiDeps = browserDeps(),
): Promise<T> {
  let res: Response
  try {
    res = await deps.fetch(path, {
      method,
      credentials: 'same-origin',
      redirect: 'manual',
      cache: 'no-store',
      headers: { ...apiHeaders(deps), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new OfflineError()
  }

  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.status === 401) {
    handleExpiredSession(deps)
  }
  const type = res.headers.get('Content-Type') ?? ''
  if (!type.includes('application/json')) {
    if (res.status === 403) throw new ForbiddenError()
    // An HTML page where JSON was expected: Access's login page.
    handleExpiredSession(deps)
  }
  let answer: unknown
  try {
    answer = await res.json()
  } catch {
    throw new OfflineError()
  }
  if (res.ok) return answer as T
  const error = (answer ?? {}) as ApiError
  if (res.status === 409 && error.error === 'app_outdated') handleOutdatedApp(deps)
  if (res.status === 409 && error.error === 'conflict') throw new ConflictError(error.changed ?? [])
  if (res.status === 403 && error.reason !== 'origin') throw new ForbiddenError()
  throw new RuleError(error.error ?? 'error', res.status, answer)
}
