// Export and restore of all the data (spec 3.8, 4.6). Shared by the app, which builds the file
// and cuts it into lots, and the Worker, which checks each lot before writing it.
//
// The file holds every table, archived rows and traceability included. Authors are first names,
// as the app reads them: no e-mail address ever leaves the server (DECISIONS.md, 2026-11-25); at
// restore, the Worker turns each first name back into the allowed address that bears it.

import {
  SCHEMA_VERSION,
  TABLE_COLUMNS,
  TABLE_NAMES,
  type Cell,
  type DataResponse,
  type Environment,
  type Row,
  type TableName,
} from './api'
import { addMonths, isIsoDate, lastDayOfMonth, monthOf, todayInParis } from './engine/dates'
import type { IsoDate } from './engine/model'

export const EXPORT_FORMAT = 'plootos-export'

export interface ExportTable {
  columns: string[]
  rows: Cell[][]
}

/** The exported file (JSON). */
export interface ExportFile {
  format: typeof EXPORT_FORMAT
  /** Version of the database schema the tables follow (number of migrations). */
  schemaVersion: number
  /** UTC timestamp. */
  exportedAt: string
  /** First name of the person who exported. */
  exportedBy: string
  environment: Environment
  tables: Record<string, ExportTable>
}

/**
 * Order of the tables in the file and at restore: parents before children (foreign keys are
 * enforced). The opening balance goes last: at restore it is written by the last lot (spec 4.3).
 */
export const RESTORE_ORDER: TableName[] = [
  'section',
  'category',
  'budget_line',
  'budget_line_version',
  'budget_override',
  'operation',
  'operation_part',
  'balance_check',
  'opening_balance',
]

/** A production export restores only in production; any other, only outside production. */
export const environmentKind = (e: Environment) => (e === 'production' ? 'production' : 'test')

/** The file of all the data, from the answer of a full read (GET /api/data and its pages). */
export function buildExport(data: DataResponse, exportedBy: string, exportedAt: string): ExportFile {
  const tables: Record<string, ExportTable> = {}
  for (const t of RESTORE_ORDER) tables[t] = { columns: [...TABLE_COLUMNS[t]], rows: data.tables[t].map((r) => [...r]) }
  return { format: EXPORT_FORMAT, schemaVersion: data.schemaVersion, exportedAt, exportedBy, environment: data.environment, tables }
}

/** 'plootos-export-2027-03-15.json'; outside production, the environment is in the name. */
export function exportFileName(environment: Environment, exportedAt: string): string {
  const day = todayInParis(new Date(exportedAt))
  const where = environment === 'production' ? '' : environment === 'staging' ? 'recette-' : 'local-'
  return `plootos-${where}export-${day}.json`
}

/**
 * Conversion of the tables of an export, from schema n to schema n + 1, one per migration after
 * the first. An export of an older schema goes through each conversion up to the app's schema;
 * a test fails if a migration has none (spec 3.8: an older export is migrated). A migration that
 * changes no exported column declares the identity.
 */
export type ExportMigration = (tables: Record<string, ExportTable>) => Record<string, ExportTable>
export const EXPORT_MIGRATIONS: Record<number, ExportMigration> = {}

export type ReadExportError =
  /** Not JSON, or not a Plootos export. */
  | 'not_export'
  /** Made by a newer version of the app. */
  | 'newer_schema'
  /** A production export outside production, or the reverse. */
  | 'other_environment'
  /** A Plootos export, but damaged or incomplete. */
  | 'invalid'

export interface ExportSummary {
  exportedAt: string
  exportedBy: string
  environment: Environment
  schemaVersion: number
  /** Operations still counted (a deleted manual entry is not). */
  operations: number
  budgetLines: number
  /** From the opening balance date to the last value date (or the opening balance date). */
  from: IsoDate
  to: IsoDate
}

export type ReadExport = { ok: true; file: ExportFile; summary: ExportSummary } | { ok: false; error: ReadExportError }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
export const isTimestamp = (v: unknown): v is string =>
  typeof v === 'string' && ISO_TIMESTAMP.test(v) && isIsoDate(v.slice(0, 10)) && !Number.isNaN(Date.parse(v))
const ENVIRONMENTS: Environment[] = ['local', 'staging', 'production']

/** A cell of the database: text, a safe integer or null. */
export const isCell = (v: unknown): v is Cell => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isSafeInteger(v))

/** The rows of a table in the order of TABLE_COLUMNS, or null if the table does not fit. */
function currentRows(table: TableName, raw: unknown): Row[] | null {
  if (!isObject(raw) || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null
  const columns = raw.columns as unknown[]
  const wanted = TABLE_COLUMNS[table] as readonly string[]
  if (columns.length !== wanted.length || new Set(columns).size !== columns.length) return null
  const at = wanted.map((c) => columns.indexOf(c))
  if (at.some((i) => i < 0)) return null
  const rows: Row[] = []
  for (const r of raw.rows as unknown[]) {
    if (!Array.isArray(r) || r.length !== wanted.length || !r.every(isCell)) return null
    rows.push(at.map((i) => r[i] as Cell))
  }
  return rows
}

/**
 * Reads a file chosen for « Restaurer depuis un export » (spec 3.8): its format, its schema
 * (an older one is converted, a newer one refused), the kind of environment it comes from, and
 * the shape of every table. The database checks the rest at restore.
 */
export function readExport(text: string, target: Environment): ReadExport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not_export' }
  }
  if (!isObject(raw) || raw.format !== EXPORT_FORMAT) return { ok: false, error: 'not_export' }
  const v = raw.schemaVersion
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) return { ok: false, error: 'invalid' }
  if (v > SCHEMA_VERSION) return { ok: false, error: 'newer_schema' }
  const environment = raw.environment as Environment
  if (!ENVIRONMENTS.includes(environment)) return { ok: false, error: 'invalid' }
  if (environmentKind(environment) !== environmentKind(target)) return { ok: false, error: 'other_environment' }
  if (!isTimestamp(raw.exportedAt) || typeof raw.exportedBy !== 'string' || !isObject(raw.tables)) {
    return { ok: false, error: 'invalid' }
  }
  let tables = raw.tables as Record<string, ExportTable>
  for (let n = v; n < SCHEMA_VERSION; n++) {
    const migrate = EXPORT_MIGRATIONS[n]
    if (!migrate) return { ok: false, error: 'invalid' }
    tables = migrate(tables)
  }
  const out: Record<string, ExportTable> = {}
  for (const t of TABLE_NAMES) {
    const rows = currentRows(t, tables[t])
    if (!rows) return { ok: false, error: 'invalid' }
    out[t] = { columns: [...TABLE_COLUMNS[t]], rows }
  }
  if (Object.keys(tables).some((t) => !(TABLE_NAMES as string[]).includes(t))) return { ok: false, error: 'invalid' }
  // An export is made once the app is set up: exactly one opening balance.
  if (out.opening_balance?.rows.length !== 1) return { ok: false, error: 'invalid' }
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: raw.exportedAt,
    exportedBy: raw.exportedBy,
    environment,
    tables: out,
  }
  return { ok: true, file, summary: summarize(file, v) }
}

const col = (t: TableName, c: string) => (TABLE_COLUMNS[t] as readonly string[]).indexOf(c)

function summarize(file: ExportFile, schemaVersion: number): ExportSummary {
  const ops = file.tables.operation?.rows ?? []
  const archived = col('operation', 'archived_at')
  const valueDate = col('operation', 'value_date')
  const opening = String(file.tables.opening_balance?.rows[0]?.[col('opening_balance', 'balance_date')] ?? '')
  const live = ops.filter((r) => r[archived] === null)
  const last = live.reduce((max, r) => (String(r[valueDate]) > max ? String(r[valueDate]) : max), opening)
  return {
    exportedAt: file.exportedAt,
    exportedBy: file.exportedBy,
    environment: file.environment,
    schemaVersion,
    operations: live.length,
    budgetLines: file.tables.budget_line?.rows.length ?? 0,
    from: opening,
    to: last,
  }
}

/** One request of a restore (POST /api/restore). Rows in the order of TABLE_COLUMNS. */
export interface RestoreLotRequest {
  /** 0 to lots - 1, sent one after the other. */
  lot: number
  lots: number
  schemaVersion: number
  /** Environment of the export: the Worker refuses another kind than its own. */
  sourceEnvironment: Environment
  /** Becomes the date of the last export once restored. */
  exportedAt: string
  /** Last lot only: rows of each table once everything is written; else the base stays blocked. */
  counts?: Record<TableName, number>
  tables: Partial<Record<TableName, Row[]>>
}

/**
 * Most rows and bytes in one lot. Each lot is one request, which must stay within the 10 ms of
 * CPU of the free Worker (spec 4.9, objective 5 ms) and the 1 MB of a write. Measured in staging
 * on three years: lots of 2,000 rows reached 15.6 ms; 500 rows is a quarter of that.
 */
export const RESTORE_LOT_ROWS = 500
export const RESTORE_LOT_BYTES = 200_000

/**
 * Cuts an export into lots: tables in RESTORE_ORDER, categories before subcategories, and the
 * opening balance in the last lot (spec 4.3).
 */
export function restoreLots(file: ExportFile, maxRows = RESTORE_LOT_ROWS, maxBytes = RESTORE_LOT_BYTES): RestoreLotRequest[] {
  const parent = col('category', 'parent_id')
  const chunks: Partial<Record<TableName, Row[]>>[] = []
  let current: Partial<Record<TableName, Row[]>> = {}
  let rows = 0
  let bytes = 0
  for (const t of RESTORE_ORDER) {
    if (t === 'opening_balance') continue
    let list = (file.tables[t]?.rows ?? []) as Row[]
    if (t === 'category') list = [...list.filter((r) => r[parent] === null), ...list.filter((r) => r[parent] !== null)]
    for (const r of list) {
      const size = JSON.stringify(r).length + 1
      if (rows > 0 && (rows + 1 > maxRows || bytes + size > maxBytes)) {
        chunks.push(current)
        current = {}
        rows = 0
        bytes = 0
      }
      ;(current[t] ??= []).push(r)
      rows += 1
      bytes += size
    }
  }
  current.opening_balance = (file.tables.opening_balance?.rows ?? []) as Row[]
  chunks.push(current)
  const counts = Object.fromEntries(RESTORE_ORDER.map((t) => [t, file.tables[t]?.rows.length ?? 0])) as Record<TableName, number>
  return chunks.map((tables, lot) => ({
    lot,
    lots: chunks.length,
    schemaVersion: file.schemaVersion,
    sourceEnvironment: file.environment,
    exportedAt: file.exportedAt,
    ...(lot === chunks.length - 1 ? { counts } : {}),
    tables,
  }))
}

/**
 * The reminder to export (spec 3.8): more than a month since the last export, or, without any,
 * since setup (DECISIONS.md, 2026-11-25). Returns the date counted from when due, else null.
 */
export function exportDue(lastExportAt: string | null, setUpAt: string, today: IsoDate): IsoDate | null {
  const from = todayInParis(new Date(lastExportAt ?? setUpAt))
  const month = addMonths(monthOf(from), 1)
  const end = lastDayOfMonth(month)
  const sameDay = `${month}-${from.slice(8, 10)}`
  const limit = sameDay > end ? end : sameDay
  return today > limit ? from : null
}
