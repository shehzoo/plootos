// Reading (spec 4.3): the browser loads everything at start and computes; the Worker only reads.
// GET /api/data gives everything but the operations, and the number of pages of operations;
// GET /api/data/operations/:page gives 1,000 operations and their parts. The app reads the
// pages in parallel. Measured in staging on three years of fictitious data, a single answer
// cost 15 to 18 ms of CPU (limit of the free plan: 10 ms); a page costs the same whatever the
// years of data.
//
// SQLite builds the JSON of the rows itself, in chunks of CHUNK_ROWS rows; the Worker only
// joins strings. Each chunk stays below D1's limit of 2 MB per string, even in the worst case,
// as texts are bounded in the schema (migration 0001).

import {
  API_VERSION,
  BASE_TABLES,
  OPERATIONS_PER_PAGE,
  TABLE_COLUMNS,
  type BaseResponse,
  type TableName,
} from '../../shared/src/api'
import type { ServerToday } from './today'
import { environmentOf } from './today'
import type { Bindings } from './types'

export const CHUNK_ROWS = 200

const AUTHOR_COLUMNS = new Set(['created_by', 'updated_by'])

/**
 * One row per chunk of CHUNK_ROWS rows, as a JSON array of arrays in the order of
 * TABLE_COLUMNS. Authors are replaced by their first name (the addresses never leave the
 * server); an address no longer allowed reads '?'. ?1 is the JSON {"address": "First name"};
 * `where` may use ?2 and ?3.
 */
export function selectSql(table: TableName, where = ''): string {
  const cells = TABLE_COLUMNS[table].map((col) =>
    AUTHOR_COLUMNS.has(col) ? `COALESCE((SELECT value FROM json_each(?1) WHERE key = t.${col}), '?')` : `t.${col}`,
  )
  return (
    `SELECT json_group_array(json(r)) AS chunk FROM (` +
    `SELECT json_array(${cells.join(', ')}) AS r, (row_number() OVER (ORDER BY t.id) - 1) / ${CHUNK_ROWS} AS c ` +
    `FROM ${table} t ${where} ORDER BY t.id) GROUP BY c ORDER BY c`
  )
}

const BASE_SQL = BASE_TABLES.map((t) => selectSql(t))
const PAGE_SQL = {
  operation: selectSql('operation', 'WHERE t.id BETWEEN ?2 AND ?3'),
  operation_part: selectSql('operation_part', 'WHERE t.operation_id BETWEEN ?2 AND ?3'),
}
const META_SQL = 'SELECT schema_version, last_export_at, restore_in_progress FROM meta WHERE id = 1'
const PAGES_SQL = `SELECT (COALESCE(max(id), 0) + ${OPERATIONS_PER_PAGE - 1}) / ${OPERATIONS_PER_PAGE} AS pages FROM operation`

export class RestoreInProgressError extends Error {
  constructor() {
    super('restore_in_progress')
  }
}

interface Meta {
  schema_version: number
  last_export_at: string | null
  restore_in_progress: number
}

/** While a restore runs, no read: the data are incomplete (spec 4.3). */
function checkMeta(result: D1Result<Record<string, unknown>> | undefined): Meta {
  const meta = result?.results[0] as Meta | undefined
  if (!meta) throw new Error('meta_missing')
  if (meta.restore_in_progress === 1) throw new RestoreInProgressError()
  return meta
}

/** The rows of a table as JSON text, from its chunks ('[[...],[...]]' each). */
function rows(result: D1Result<Record<string, unknown>> | undefined): string {
  const chunks = (result?.results ?? []).map((r) => String(r.chunk).slice(1, -1)).filter((s) => s.length > 0)
  return `[${chunks.join(',')}]`
}

const people = (users: Map<string, string>) => JSON.stringify(Object.fromEntries(users))

/** The body of GET /api/data, as JSON text (see BaseResponse). One batch: one state of the base. */
export async function readBase(
  env: Pick<Bindings, 'DB' | 'ENVIRONMENT'>,
  users: Map<string, string>,
  today: ServerToday,
): Promise<string> {
  const p = people(users)
  const [metaResult, pagesResult, ...results] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(META_SQL),
    env.DB.prepare(PAGES_SQL),
    ...BASE_SQL.map((sql) => env.DB.prepare(sql).bind(p)),
  ])
  const meta = checkMeta(metaResult)
  const head: Omit<BaseResponse, 'tables'> = {
    apiVersion: API_VERSION,
    environment: environmentOf(env),
    today: today.today,
    todaySimulated: today.simulated,
    schemaVersion: meta.schema_version,
    lastExportAt: meta.last_export_at,
    operationPages: Number(pagesResult?.results[0]?.pages ?? 0),
  }
  const tables = BASE_TABLES.map((t, i) => `${JSON.stringify(t)}:${rows(results[i])}`)
  return `${JSON.stringify(head).slice(0, -1)},"tables":{${tables.join(',')}}}`
}

/** The body of GET /api/data/operations/:page, as JSON text (see OperationsPageResponse). */
export async function readOperationsPage(
  env: Pick<Bindings, 'DB'>,
  users: Map<string, string>,
  page: number,
): Promise<string> {
  const p = people(users)
  const first = page * OPERATIONS_PER_PAGE + 1
  const last = (page + 1) * OPERATIONS_PER_PAGE
  const [metaResult, ops, parts] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(META_SQL),
    env.DB.prepare(PAGE_SQL.operation).bind(p, first, last),
    env.DB.prepare(PAGE_SQL.operation_part).bind(p, first, last),
  ])
  checkMeta(metaResult)
  return `{"page":${page},"tables":{"operation":${rows(ops)},"operation_part":${rows(parts)}}}`
}
