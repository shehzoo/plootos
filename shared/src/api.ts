// Shapes exchanged between the browser and the Worker.

/**
 * Compatibility number of the exchange. It goes up only when the exchange changes in a way an
 * older app cannot handle; the Worker then refuses the older app, which reloads (spec 4.8).
 */
export const API_VERSION = 1

/** Sent by the app with every API request. */
export const API_VERSION_HEADER = 'X-Plootos-Api'
/** Simulated "today" ('YYYY-MM-DD'), honoured in local development and staging only. */
export const SIMULATED_TODAY_HEADER = 'X-Plootos-Today'

export type Environment = 'local' | 'staging' | 'production'

export interface MeResponse {
  firstName: string
}

/** Error body of every refused API request: fixed codes, never a value of the request. */
export interface ApiError {
  error: string
  reason?: string
  /** On a write conflict: the elements changed meanwhile ("Modifié entre-temps"). */
  changed?: { table: TableName; id: number }[]
}

const TRACE = ['created_by', 'created_at', 'updated_by', 'updated_at'] as const

/**
 * Columns sent for each table, in this order (spec 4.5). Authors are sent as first names,
 * never as addresses. One definition for the Worker's queries and the app's decoding.
 */
export const TABLE_COLUMNS = {
  section: ['id', 'name', 'direction', 'sort_order', 'archived_at', 'row_version', ...TRACE],
  category: ['id', 'name', 'parent_id', 'section_id', 'sort_order', 'archived_at', 'row_version', ...TRACE],
  budget_line: ['id', 'label', 'row_version', ...TRACE],
  budget_line_version: [
    'id',
    'budget_line_id',
    'category_id',
    'amount_cents',
    'start_month',
    'end_month',
    'replaced_at',
    'rhythm',
    'every_n',
    'anchor_month',
    'months',
    'row_version',
    ...TRACE,
  ],
  budget_override: ['id', 'budget_line_id', 'month', 'amount_cents', 'reason', 'removed_at', 'row_version', ...TRACE],
  operation: [
    'id',
    'op_date',
    'value_date',
    'amount_cents',
    'origin',
    'bank_label',
    'bank_label_raw',
    'dup_rank',
    'comment',
    'archived_at',
    'row_version',
    ...TRACE,
  ],
  operation_part: ['id', 'operation_id', 'category_id', 'amount_cents', 'row_version', ...TRACE],
  opening_balance: ['balance_date', 'amount_cents', 'row_version', ...TRACE],
  balance_check: ['id', 'check_date', 'bank_balance_cents', 'gap_cents', ...TRACE],
} as const

export type TableName = keyof typeof TABLE_COLUMNS
export const TABLE_NAMES = Object.keys(TABLE_COLUMNS) as TableName[]

/** Tables whose rows carry a row_version (spec 4.5). */
export const VERSIONED_TABLES = [
  'section',
  'category',
  'budget_line',
  'budget_line_version',
  'budget_override',
  'operation',
  'operation_part',
  'opening_balance',
] as const satisfies readonly TableName[]
export type VersionedTable = (typeof VERSIONED_TABLES)[number]

export type Cell = string | number | null
/** One row: its cells in the order of TABLE_COLUMNS. */
export type Row = Cell[]

/** GET /api/data: everything, loaded at start (spec 4.3). */
export interface DataResponse {
  apiVersion: number
  environment: Environment
  /** "Today" for the server: Paris time, or the simulated date (local and staging only). */
  today: string
  todaySimulated: boolean
  schemaVersion: number
  lastExportAt: string | null
  tables: { [T in TableName]: Row[] }
}
