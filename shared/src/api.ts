// Shapes exchanged between the browser and the Worker.

/**
 * Compatibility number of the exchange. It goes up only when the exchange changes in a way an
 * older app cannot handle; the Worker then refuses the older app, which reloads (spec 4.8).
 */
export const API_VERSION = 2

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

/** Operations and their parts are read by pages (GET /api/data/operations/:page). */
export const PAGED_TABLES = ['operation', 'operation_part'] as const satisfies readonly TableName[]
export type PagedTable = (typeof PAGED_TABLES)[number]
export type BaseTable = Exclude<TableName, PagedTable>
export const BASE_TABLES = TABLE_NAMES.filter((t) => !(PAGED_TABLES as readonly string[]).includes(t)) as BaseTable[]

/**
 * Operations per page: page k holds the operations whose id is in [k x 1000 + 1, (k + 1) x 1000],
 * with their parts. The Worker's cost per request stays the same whatever the years of data
 * (measured in staging: reading three years in one request cost 15 to 18 ms of CPU).
 */
export const OPERATIONS_PER_PAGE = 1000

/** GET /api/data: everything but the operations, and how many pages of operations to read. */
export interface BaseResponse extends Omit<DataResponse, 'tables'> {
  tables: { [T in BaseTable]: Row[] }
  operationPages: number
}

/** GET /api/data/operations/:page */
export interface OperationsPageResponse {
  page: number
  tables: { [T in PagedTable]: Row[] }
}

/** Everything, once the base and every page are read (spec 4.3: all is loaded at start). */
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

// Writes (lot 7): requests and answers. Errors are ApiError with a fixed code (never a value).

/** Answer of every successful write: the ids of the rows inserted, in insertion order. */
export interface WriteResult {
  ok: true
  ids: number[]
}

/** POST /api/setup (spec 3.8): the bank balance at the end of the previous month. */
export interface SetupRequest {
  amountCents: number
}

/** The six sections created at setup (spec 3.8). */
export const INITIAL_SECTIONS = [
  ['Revenus réguliers', 'in'],
  ['Revenus ponctuels', 'in'],
  ['Dépenses fixes', 'out'],
  ['Dépenses courantes', 'out'],
  ['Dépenses ponctuelles', 'out'],
  ['Épargne', 'out'],
] as const

/** POST /api/sections */
export interface NewSectionRequest {
  name: string
  direction: 'in' | 'out'
}

/** POST /api/categories: a category (sectionId) or a subcategory (parentId). */
export type NewCategoryRequest = { name: string } & (
  | { sectionId: number }
  | { parentId: number; confirmFirstSub?: boolean }
)

/** PATCH /api/sections/:id, PATCH /api/categories/:id (sectionId: level 1 only, same direction). */
export interface UpdateRequest {
  rowVersion: number
  name?: string
  sectionId?: number
}

/** POST /api/sections/:id/archive, POST /api/categories/:id/archive */
export interface ArchiveRequest {
  rowVersion: number
}

/** POST /api/order: the whole group in its new order, each with the version the app read. */
export interface OrderRequest {
  kind: 'section' | 'category'
  /** Categories of a section, or subcategories of a category. */
  group?: { sectionId: number } | { parentId: number }
  items: { id: number; rowVersion: number }[]
}

/** PATCH /api/opening-balance: the amount only, its date never changes (spec 3.8). */
export interface OpeningBalanceRequest {
  rowVersion: number
  amountCents: number
}

// Writes of lot 8: budget lines and overrides (spec 3.6, R3, R4). Amounts are positive cents.

/** Rhythm of a new version. An "every N months" rhythm may leave its anchor out: kept (R3). */
export type RhythmRequest =
  | { kind: 'every_n'; everyN: number; anchorMonth?: string }
  | { kind: 'months'; months: number[] }

/** POST /api/budget-lines: a new line, anchored on its first month (spec 3.6). */
export interface NewLineRequest {
  label: string
  categoryId: number
  amountCents: number
  /** The current month at the earliest. */
  startMonth: string
  rhythm: { kind: 'every_n'; everyN: number } | { kind: 'months'; months: number[] }
}

/** A change of amount, category or rhythm from a month on: a new version (R3). */
export interface LineChangeRequest {
  fromMonth: string
  categoryId: number
  amountCents: number
  rhythm: RhythmRequest
}

/** PATCH /api/budget-lines/:id: a new name (no version), a change (R3), or both. */
export interface UpdateLineRequest {
  rowVersion: number
  label?: string
  change?: LineChangeRequest
}

/** POST /api/budget-lines/:id/archive: its last month, the month before the current one at the earliest (R4). */
export interface ArchiveLineRequest {
  rowVersion: number
  lastMonth: string
}

/**
 * POST /api/budget-lines/:id/override: the amount of a month where the line applies (current
 * or later). An override already there is marked removed and a new one created (DECISIONS.md,
 * 2026-11-25). 0 cancels the line that month.
 */
export interface OverrideRequest {
  rowVersion: number
  month: string
  amountCents: number
  reason: string | null
}

/** POST /api/budget-lines/:id/override/remove */
export interface RemoveOverrideRequest {
  rowVersion: number
  month: string
}
