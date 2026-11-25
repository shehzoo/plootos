// What every write route shares: reading and checking the request, answering a write.
// Errors are fixed codes, never a value of the request (spec 4.3, 4.8).

import type { Context } from 'hono'
import type { ApiError, WriteResult } from '../../shared/src/api'
import type { AppEnv } from './types'
import { WriteBatch, type WriteOutcome } from './write'

export type C = Context<AppEnv>

export class BadRequest extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

export const MAX_CENTS = 100_000_000_000

export async function readBody(c: C): Promise<Record<string, unknown>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new BadRequest('json')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequest('json')
  return raw as Record<string, unknown>
}

export function integer(v: unknown, reason: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new BadRequest(reason)
  return v
}

export const rowVersion = (v: unknown) => integer(v, 'row_version', 1, 1_000_000_000)

/** A name or a label: trimmed, 1 to 200 characters (spec 4.5). */
export function nameOf(v: unknown, reason = 'name'): string {
  if (typeof v !== 'string') throw new BadRequest(reason)
  const name = v.trim()
  if (name.length === 0 || name.length > 200) throw new BadRequest(reason)
  return name
}

export function idParam(c: C): number {
  const raw = c.req.param('id') ?? ''
  if (!/^\d{1,9}$/.test(raw)) throw new BadRequest('id')
  return Number(raw)
}

export const fail = (c: C, status: 404 | 422, error: string) => c.json({ error } satisfies ApiError, status)

export function respond(c: C, out: WriteOutcome) {
  if (out.ok) return c.json({ ok: true, ids: out.insertedIds } satisfies WriteResult)
  return c.json(out.body, out.status)
}

export const first = <T>(c: C, sql: string, ...params: unknown[]) => c.env.DB.prepare(sql).bind(...params).first<T>()
export const all = async <T>(c: C, sql: string, ...params: unknown[]) =>
  (await c.env.DB.prepare(sql).bind(...params).all<T>()).results

/** A write batch for the person of the request; nothing is written before the app is set up. */
export function catalogBatch(c: C): WriteBatch {
  return new WriteBatch(c.env.DB, c.get('user').email).guard('EXISTS (SELECT 1 FROM opening_balance)', [], 'not_set_up')
}

export const route = (fn: (c: C) => Promise<Response>) => async (c: C) => {
  try {
    return await fn(c)
  } catch (e) {
    if (e instanceof BadRequest) return c.json({ error: 'bad_request', reason: e.reason } satisfies ApiError, 400)
    throw e
  }
}
