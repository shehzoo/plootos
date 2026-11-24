// Environment and "today" on the server (spec 4.3). A simulated date is honoured in local
// development and staging only, so that the screens can be tested on a chosen day.

import type { Context } from 'hono'
import { SIMULATED_TODAY_HEADER, type Environment } from '../../shared/src/api'
import { isIsoDate, todayInParis } from '../../shared/src/engine/dates'
import type { AppEnv, Bindings } from './types'

/** Fails safe: any value but 'local' or 'staging' is production. */
export function environmentOf(env: Pick<Bindings, 'ENVIRONMENT'>): Environment {
  return env.ENVIRONMENT === 'local' || env.ENVIRONMENT === 'staging' ? env.ENVIRONMENT : 'production'
}

export function simulationAllowed(env: Pick<Bindings, 'ENVIRONMENT'>): boolean {
  return environmentOf(env) !== 'production'
}

export interface ServerToday {
  today: string
  simulated: boolean
}

export function serverToday(c: Context<AppEnv>, now: Date = new Date()): ServerToday {
  const asked = c.req.header(SIMULATED_TODAY_HEADER)
  if (asked && simulationAllowed(c.env) && isIsoDate(asked)) return { today: asked, simulated: true }
  return { today: todayInParis(now), simulated: false }
}
