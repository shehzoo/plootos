// Loading of all the data at start (spec 4.3), with the measures of the lot 3 criterion:
// under 2 s on a phone with three years of data.

import type { DataResponse, Environment } from '../../shared/src/api'
import { addMonths, Ledger, monthOf } from '../../shared/src/engine'
import { budgetData, decodeData, type AppData } from '../../shared/src/wire'
import { apiGetText, browserDeps, type ApiDeps } from './api'

export interface LoadTimings {
  /** Request sent to answer received (network and server). */
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
  /** Null until the app is set up (no opening balance, spec 3.8). */
  ledger: Ledger | null
  timings: LoadTimings
  bytes: number
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

export async function loadData(deps: ApiDeps = browserDeps(), clock: () => number = () => performance.now()): Promise<Loaded> {
  const t0 = clock()
  const text = await apiGetText('/api/data', deps)
  const t1 = clock()
  const res = JSON.parse(text) as DataResponse
  const app = decodeData(res)
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
    ledger,
    timings: { networkMs: t1 - t0, readMs: t2 - t1, computeMs: t3 - t2, totalMs: t3 - t0 },
    bytes: text.length,
  }
}
