// Loading of all the data at start (spec 4.3): the base, then every page of operations in
// parallel. With the measures of the lot 3 criterion: under 2 s on a phone with three years.

import type { BaseResponse, DataResponse, Environment, OperationsPageResponse } from '../../shared/src/api'
import { addMonths, Ledger, monthOf } from '../../shared/src/engine'
import { assemble, budgetData, decodeData, isConsistent, type AppData } from '../../shared/src/wire'
import { apiGetText, browserDeps, type ApiDeps } from './api'

export interface LoadTimings {
  /** First request sent to last answer received (network and server). */
  networkMs: number
  /** JSON read and decoded into the engine's model. */
  readMs: number
  /** Calculations of the current month and of the projection. */
  computeMs: number
  totalMs: number
}

export interface Loaded {
  app: AppData
  environment: Environment
  today: string
  todaySimulated: boolean
  /** UTC timestamp of the last export, null if none (spec 3.8). */
  lastExportAt: string | null
  /** Null until the app is set up (no opening balance, spec 3.8). */
  ledger: Ledger | null
  timings: LoadTimings
  bytes: number
  requests: number
}

export class InconsistentDataError extends Error {
  constructor() {
    super('inconsistent_data')
  }
}

/**
 * What the current-month screen and the projection will compute at start (lots 5 and 6):
 * every category of the month, every section, the projected end balance, the projection.
 */
export function computeAtStart(ledger: Ledger, today: string): number {
  const month = monthOf(today)
  let check = 0
  for (const c of ledger.data.categories) {
    check += ledger.planned(c.id, month) + ledger.actual(c.id, month)
    check += ledger.remaining(c.id, month) ?? 0
    check += ledger.gap(c.id, addMonths(month, -1))
  }
  for (const s of ledger.data.sections) check += ledger.sectionRemaining(s.id, month).remainingCents
  check += ledger.currentMonthEnd(month).amountCents
  for (const row of ledger.projection(month)) check += row.endBalanceCents
  return check
}

const ATTEMPTS = 3

export interface FullRead {
  res: DataResponse
  app: AppData
  bytes: number
  requests: number
  /** Clock at the first request sent, and at the last answer received. */
  startedAt: number
  receivedAt: number
}

/**
 * Everything, as one state of the base: GET /api/data, then every page in parallel; read again
 * if a page cites an element the base does not have (a write in between). Also the source of an
 * export (lot 11).
 */
export async function readAll(deps: ApiDeps = browserDeps(), clock: () => number = () => performance.now()): Promise<FullRead> {
  for (let attempt = 1; ; attempt++) {
    const t0 = clock()
    const baseText = await apiGetText('/api/data', deps)
    const base = JSON.parse(baseText) as BaseResponse
    const pageTexts = await Promise.all(
      Array.from({ length: base.operationPages }, (_, k) => apiGetText(`/api/data/operations/${k}`, deps)),
    )
    const t1 = clock()
    const res = assemble(base, pageTexts.map((t) => JSON.parse(t) as OperationsPageResponse))
    const app = decodeData(res)
    if (!isConsistent(app)) {
      if (attempt < ATTEMPTS) continue
      throw new InconsistentDataError()
    }
    return { res, app, startedAt: t0, receivedAt: t1, bytes: baseText.length + pageTexts.reduce((n, t) => n + t.length, 0), requests: 1 + pageTexts.length }
  }
}

export async function loadData(deps: ApiDeps = browserDeps(), clock: () => number = () => performance.now()): Promise<Loaded> {
  const { res, app, startedAt: t0, receivedAt: t1, bytes, requests } = await readAll(deps, clock)
  const data = budgetData(app)
  const t2 = clock()
  const ledger = data ? new Ledger(data) : null
  if (ledger) computeAtStart(ledger, res.today)
  const t3 = clock()
  return {
    app,
    environment: res.environment,
    today: res.today,
    todaySimulated: res.todaySimulated,
    lastExportAt: res.lastExportAt,
    ledger,
    timings: { networkMs: t1 - t0, readMs: t2 - t1, computeMs: t3 - t2, totalMs: t3 - t0 },
    bytes,
    requests,
  }
}
