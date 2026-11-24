// GET /api/data: everything, in one answer (spec 4.3). The browser computes; the Worker only
// reads. One D1 batch, so that every table is read from the same state of the database.
//
// SQLite builds the JSON of the rows itself, in chunks of CHUNK_ROWS rows; the Worker only
// joins strings. Measured on three years of fictitious data, building the answer from row
// objects in the Worker took about 19 ms of CPU, beyond the 10 ms of the free plan; this way,
// under 4 ms. Each chunk stays below D1's limit of 2 MB per string, even in the worst case, as texts are bounded
// in the schema (migration 0001).

import { API_VERSION, TABLE_COLUMNS, TABLE_NAMES, type DataResponse, type TableName } from '../../shared/src/api'
import type { ServerToday } from './today'
import { environmentOf } from './today'
import type { Bindings } from './types'

export const CHUNK_ROWS = 200

const AUTHOR_COLUMNS = new Set(['created_by', 'updated_by'])

/**
 * One row per chunk of CHUNK_ROWS rows, as a JSON array of arrays in the order of
 * TABLE_COLUMNS. Authors are replaced by their first name (the addresses never leave the
 * server); an address no longer allowed reads '?'. ?1 is the JSON {"address": "First name"}.
 */
export function selectSql(table: TableName): string {
  const cells = TABLE_COLUMNS[table].map((col) =>
    AUTHOR_COLUMNS.has(col) ? `COALESCE((SELECT value FROM json_each(?1) WHERE key = t.${col}), '?')` : `t.${col}`,
  )
  return (
    `SELECT json_group_array(json(r)) AS chunk FROM (` +
    `SELECT json_array(${cells.join(', ')}) AS r, (row_number() OVER (ORDER BY t.id) - 1) / ${CHUNK_ROWS} AS c ` +
    `FROM ${table} t ORDER BY t.id) GROUP BY c ORDER BY c`
  )
}

const SQL = Object.fromEntries(TABLE_NAMES.map((t) => [t, selectSql(t)])) as Record<TableName, string>

export class RestoreInProgressError extends Error {
  constructor() {
    super('restore_in_progress')
  }
}

/** The body of GET /api/data, as JSON text (see DataResponse). */
export async function readAll(
  env: Pick<Bindings, 'DB' | 'ENVIRONMENT'>,
  users: Map<string, string>,
  today: ServerToday,
): Promise<string> {
  const people = JSON.stringify(Object.fromEntries(users))
  const statements = [
    env.DB.prepare('SELECT schema_version, last_export_at, restore_in_progress FROM meta WHERE id = 1'),
    ...TABLE_NAMES.map((t) => env.DB.prepare(SQL[t]).bind(people)),
  ]
  const [metaResult, ...results] = await env.DB.batch<Record<string, unknown>>(statements)
  const meta = metaResult?.results[0] as
    | { schema_version: number; last_export_at: string | null; restore_in_progress: number }
    | undefined
  if (!meta) throw new Error('meta_missing')
  // While a restore runs, no read: the data are incomplete (spec 4.3).
  if (meta.restore_in_progress === 1) throw new RestoreInProgressError()

  const head: Omit<DataResponse, 'tables'> = {
    apiVersion: API_VERSION,
    environment: environmentOf(env),
    today: today.today,
    todaySimulated: today.simulated,
    schemaVersion: meta.schema_version,
    lastExportAt: meta.last_export_at,
  }
  const tables = TABLE_NAMES.map((t, i) => {
    // Each chunk is '[[...],[...]]': its rows are joined into one array.
    const rows = (results[i]?.results ?? []).map((r) => String(r.chunk).slice(1, -1)).filter((s) => s.length > 0)
    return `${JSON.stringify(t)}:[${rows.join(',')}]`
  })
  return `${JSON.stringify(head).slice(0, -1)},"tables":{${tables.join(',')}}}`
}
