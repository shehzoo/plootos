// Lot 11: export and restore (spec 3.8, 4.3, 4.6).
//
// The export is built by the app from a full read (the same paged requests as at start): the
// Worker only records its date, POST /api/exports.
//
// A restore goes on an empty database only, in lots sent one after the other (POST /api/restore),
// each within the 10 ms of CPU of a request (spec 4.9). The first lot sets the marker
// meta.restore_in_progress; while it is set, every other read and write is refused. The last lot
// writes the opening balance, checks that every table has the number of rows the export holds,
// then clears the marker. A lot that fails after the first leaves the base blocked: the app then
// says « Restauration inachevée », to be emptied by the GitHub action « Vider la base ».
//
// Rows keep the ids, versions and traceability of the export. Authors come as first names: each
// becomes the allowed address bearing it, an unknown one is stored as '?' (DECISIONS.md,
// 2026-11-25). Table and column names only ever come from this code.

import { Hono } from 'hono'
import { SCHEMA_VERSION, TABLE_COLUMNS, TABLE_NAMES, type ExportRecorded, type RestoreLotResult, type Row, type TableName } from '../../shared/src/api'
import { environmentKind, isCell, isTimestamp, RESTORE_ORDER } from '../../shared/src/backup'
import { EMPTY } from './catalog'
import { BadRequest, catalogBatch, integer, readBody, route, type C } from './request'
import { environmentOf, serverToday } from './today'
import type { AppEnv } from './types'
import { WriteBatch } from './write'

export const restore = new Hono<AppEnv>()

restore.post(
  '/api/exports',
  route(async (c) => {
    const w = catalogBatch(c)
    // On the simulated day, when there is one (local and staging only), like the file itself.
    const today = serverToday(c)
    const at = today.simulated ? `${today.today}${w.now.slice(10)}` : w.now
    w.statement('UPDATE meta SET last_export_at = ? WHERE id = 1', [at])
    const out = await w.run()
    if (!out.ok) return c.json(out.body, out.status)
    return c.json({ ok: true, lastExportAt: at } satisfies ExportRecorded)
  }),
)

const AUTHORS = new Set(['created_by', 'updated_by'])
/** Columns holding integers (ids, amounts, versions, orders, ranks); every other one holds text. */
const isIntegerColumn = (c: string) =>
  c === 'id' || c.endsWith('_id') || c.endsWith('_cents') || ['row_version', 'sort_order', 'every_n', 'dup_rank'].includes(c)

/** The rows of a table, checked cell by cell: text or integer per column, as the schema has them. */
function tableRows(table: TableName, raw: unknown): Row[] {
  const columns = TABLE_COLUMNS[table] as readonly string[]
  if (!Array.isArray(raw)) throw new BadRequest('rows')
  return raw.map((r) => {
    if (!Array.isArray(r) || r.length !== columns.length || !r.every(isCell)) throw new BadRequest('rows')
    columns.forEach((col, i) => {
      const v = r[i]
      if (v === null) return
      if (isIntegerColumn(col) ? typeof v !== 'number' : typeof v !== 'string') throw new BadRequest('rows')
    })
    return r as Row
  })
}

/** INSERT of all the rows of one table in one statement: the rows go as one JSON parameter. */
function insertSql(table: TableName): string {
  const columns = [...(TABLE_COLUMNS[table] as readonly string[])]
  const cells = columns.map((_, i) => `json_extract(value, '$[${i}]')`)
  // The opening balance has a single row, id 1, not sent.
  if (table === 'opening_balance') {
    columns.unshift('id')
    cells.unshift('1')
  }
  return `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${cells.join(', ')} FROM json_each(?) ORDER BY key`
}

/** First name to allowed address (the first address bearing it). */
function addressesByName(users: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [address, name] of users) if (!out.has(name)) out.set(name, address)
  return out
}

const sameKind = (c: C, source: unknown) =>
  (source === 'local' || source === 'staging' || source === 'production') && environmentKind(source) === environmentKind(environmentOf(c.env))

restore.post(
  '/api/restore',
  route(async (c) => {
    const b = await readBody(c)
    const lots = integer(b.lots, 'lots', 1, 100_000)
    const lot = integer(b.lot, 'lot', 0, lots - 1)
    const last = lot === lots - 1
    // The app converts an older export before sending it (spec 3.8).
    if (b.schemaVersion !== SCHEMA_VERSION) return c.json({ error: 'schema_mismatch' }, 422)
    if (!sameKind(c, b.sourceEnvironment)) return c.json({ error: 'other_environment' }, 422)
    if (!isTimestamp(b.exportedAt)) throw new BadRequest('exported_at')
    const tables = b.tables
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)) throw new BadRequest('tables')
    const names = Object.keys(tables)
    if (names.some((t) => !(TABLE_NAMES as string[]).includes(t))) throw new BadRequest('tables')
    const sent = tables as Record<string, unknown>
    const rows = Object.fromEntries(names.map((t) => [t, tableRows(t as TableName, sent[t])])) as Partial<Record<TableName, Row[]>>
    // The opening balance is written by the last lot, alone of its kind.
    if (last ? rows.opening_balance?.length !== 1 : rows.opening_balance !== undefined) throw new BadRequest('opening_balance')
    let counts: Record<string, number> = {}
    if (last) {
      const raw = b.counts
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequest('counts')
      counts = Object.fromEntries(RESTORE_ORDER.map((t) => [t, integer((raw as Record<string, unknown>)[t], 'counts', 0, 10_000_000)]))
    }

    const byName = addressesByName(c.get('users'))
    const w = new WriteBatch(c.env.DB, c.get('user').email, undefined, true)
    w.guard('EXISTS (SELECT 1 FROM meta WHERE id = 1 AND schema_version = ?)', [SCHEMA_VERSION], 'schema_mismatch')
    if (lot === 0) {
      w.guard(`${EMPTY} AND EXISTS (SELECT 1 FROM meta WHERE restore_in_progress = 0)`, [], 'not_empty')
      w.statement('UPDATE meta SET restore_in_progress = 1 WHERE id = 1')
    } else {
      w.guard('EXISTS (SELECT 1 FROM meta WHERE restore_in_progress = 1)', [], 'restore_not_started')
    }
    for (const t of RESTORE_ORDER) {
      const list = rows[t]
      if (!list || list.length === 0) continue
      const columns = TABLE_COLUMNS[t] as readonly string[]
      const authorAt = columns.flatMap((col, i) => (AUTHORS.has(col) ? [i] : []))
      const mapped = list.map((r) => {
        const out = [...r]
        for (const i of authorAt) out[i] = byName.get(String(out[i])) ?? '?'
        return out
      })
      w.statement(insertSql(t), [JSON.stringify(mapped)])
    }
    if (last) {
      for (const t of RESTORE_ORDER) w.guard(`(SELECT count(*) FROM ${t}) = ?`, [counts[t]], 'incomplete')
      w.statement('UPDATE meta SET restore_in_progress = 0, last_export_at = ? WHERE id = 1', [b.exportedAt])
    }
    const out = await w.run()
    if (!out.ok) return c.json(out.body, out.status)
    return c.json({ ok: true, lot, done: last } satisfies RestoreLotResult)
  }),
)
