// Fictitious data sets, as database rows: written as SQL for a local or staging database
// (scripts/seed.ts), or as the answer the Worker would give (tests). Never real data.

import { TABLE_COLUMNS, TABLE_NAMES, type Cell, type DataResponse, type Row, type TableName } from '../src/api'
import type { BudgetData, Id, IsoDate } from '../src/engine/model'

/** Addresses of person 1 and person 2 (fictitious, or read from the staging secret). */
export type Authors = readonly [string, string]

export interface Authorship {
  /** 0: person 1, 1: person 2. */
  createdBy: 0 | 1
  createdAt: string
  updatedBy: 0 | 1
  updatedAt: string
}

export interface SeedBalanceCheck {
  id: Id
  checkDate: IsoDate
  bankBalanceCents: number
  gapCents: number
}

export interface SeedInput {
  data: BudgetData
  balanceChecks: SeedBalanceCheck[]
  /** Who created and last changed each row, and when. */
  authorship: (table: TableName, id: Id) => Authorship
}

export type DbRow = Record<string, Cell>
export type SeedData = Record<TableName, DbRow[]>

/** Insertion order: parents before children (foreign keys are enforced). */
export const INSERT_ORDER: TableName[] = [
  'section',
  'category',
  'budget_line',
  'budget_line_version',
  'budget_override',
  'operation',
  'operation_part',
  'opening_balance',
  'balance_check',
]

/**
 * Every table the migrations create, children first, the migration history last: dropping them
 * all gives an empty database, on which the migrations run again from the start.
 */
export const DROP_ORDER = [
  'operation_part',
  'operation',
  'budget_override',
  'budget_line_version',
  'budget_line',
  'category',
  'section',
  'opening_balance',
  'balance_check',
  'meta',
  'write_guard',
  'd1_migrations',
] as const

export function toSeed(input: SeedInput, authors: Authors): SeedData {
  const { data } = input
  const trace = (table: TableName, id: Id): DbRow => {
    const a = input.authorship(table, id)
    return { created_by: authors[a.createdBy], created_at: a.createdAt, updated_by: authors[a.updatedBy], updated_at: a.updatedAt }
  }
  // Level-1 categories first: a subcategory refers to its parent.
  const categories = [...data.categories].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null) || a.id - b.id)
  return {
    section: data.sections.map((s) => ({
      id: s.id,
      name: s.name,
      direction: s.direction,
      sort_order: s.sortOrder,
      archived_at: s.archivedAt,
      row_version: 1,
      ...trace('section', s.id),
    })),
    category: categories.map((c) => ({
      id: c.id,
      name: c.name,
      parent_id: c.parentId,
      section_id: c.sectionId,
      sort_order: c.sortOrder,
      archived_at: c.archivedAt,
      row_version: 1,
      ...trace('category', c.id),
    })),
    budget_line: data.budgetLines.map((l) => ({ id: l.id, label: l.label, row_version: 1, ...trace('budget_line', l.id) })),
    budget_line_version: data.versions.map((v) => ({
      id: v.id,
      budget_line_id: v.budgetLineId,
      category_id: v.categoryId,
      amount_cents: v.amountCents,
      start_month: v.startMonth,
      end_month: v.endMonth,
      replaced_at: v.replacedAt,
      rhythm: v.rhythm.kind,
      every_n: v.rhythm.kind === 'every_n' ? v.rhythm.everyN : null,
      anchor_month: v.rhythm.kind === 'every_n' ? v.rhythm.anchorMonth : null,
      months: v.rhythm.kind === 'months' ? v.rhythm.months.join(',') : null,
      row_version: 1,
      ...trace('budget_line_version', v.id),
    })),
    budget_override: data.overrides.map((o) => ({
      id: o.id,
      budget_line_id: o.budgetLineId,
      month: o.month,
      amount_cents: o.amountCents,
      reason: o.reason,
      removed_at: o.removedAt,
      row_version: 1,
      ...trace('budget_override', o.id),
    })),
    operation: data.operations.map((o) => ({
      id: o.id,
      op_date: o.opDate,
      value_date: o.valueDate,
      amount_cents: o.amountCents,
      origin: o.origin,
      bank_label: o.bankLabel,
      bank_label_raw: o.bankLabelRaw,
      dup_rank: o.dupRank,
      comment: o.comment,
      archived_at: o.archivedAt,
      row_version: 1,
      ...trace('operation', o.id),
    })),
    operation_part: data.parts.map((p) => ({
      id: p.id,
      operation_id: p.operationId,
      category_id: p.categoryId,
      amount_cents: p.amountCents,
      row_version: 1,
      ...trace('operation_part', p.id),
    })),
    opening_balance: [
      {
        id: 1,
        balance_date: data.openingBalance.balanceDate,
        amount_cents: data.openingBalance.amountCents,
        row_version: 1,
        ...trace('opening_balance', 1),
      },
    ],
    balance_check: input.balanceChecks.map((b) => ({
      id: b.id,
      check_date: b.checkDate,
      bank_balance_cents: b.bankBalanceCents,
      gap_cents: b.gapCents,
      ...trace('balance_check', b.id),
    })),
  }
}

export const EMPTY_SEED: SeedData = Object.fromEntries(TABLE_NAMES.map((t) => [t, []])) as unknown as SeedData

function literal(value: Cell): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('seed: invalid number')
    return String(value)
  }
  return `'${value.replaceAll("'", "''")}'`
}

/** Rows per INSERT: well under D1's 100 KB per statement. */
const ROWS_PER_INSERT = 50

/** INSERT statements, parents first, for a database whose migrations ran. */
export function seedSql(seed: SeedData): string {
  const out: string[] = []
  for (const table of INSERT_ORDER) {
    const rows = seed[table]
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const chunk = rows.slice(i, i + ROWS_PER_INSERT)
      const columns = Object.keys(chunk[0] as DbRow)
      const values = chunk.map((r) => `(${columns.map((c) => literal(r[c] ?? null)).join(', ')})`)
      out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values.join(',\n')};`)
    }
  }
  return out.join('\n') + '\n'
}

/** Drops every table, migration history included: the migrations then run from the start. */
export function dropSql(): string {
  return DROP_ORDER.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n') + '\n'
}

/** The answer of GET /api/data on these rows (addresses replaced by first names). */
export function seedResponse(seed: SeedData, users: Map<string, string>, today: string): DataResponse {
  const tables = {} as Record<TableName, Row[]>
  for (const t of TABLE_NAMES) {
    tables[t] = [...seed[t]]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((r) =>
        TABLE_COLUMNS[t].map((c) =>
          c === 'created_by' || c === 'updated_by' ? (users.get(String(r[c])) ?? '?') : (r[c] ?? null),
        ),
      )
  }
  return {
    apiVersion: 1,
    environment: 'local',
    today,
    todaySimulated: false,
    schemaVersion: 1,
    lastExportAt: null,
    tables,
  }
}
