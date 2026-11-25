// Write framework (spec 4.3). Every gesture that writes is one D1 batch: all or nothing.
// D1 has no transaction spanning a read and a write, so the conditions a write depends on are
// checked inside the batch itself, by "guards": a guard inserts into write_guard, whose
// constraint fails, when its condition is false; D1 then cancels the whole batch.
//
// Table and column names only ever come from this code, never from a request.

import { TABLE_COLUMNS, type ApiError, type TableName, type VersionedTable } from '../../shared/src/api'

/** A piece of SQL used as a value, e.g. the id of a row inserted earlier in the same batch. */
export class SqlValue {
  constructor(
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
}

/**
 * Id of the row inserted last into a table, earlier in the same batch. Ids are plain
 * INTEGER PRIMARY KEY: a new row takes the highest id plus one, and the batch runs alone.
 */
export const lastInsertedId = (table: TableName) => new SqlValue(`(SELECT max(id) FROM ${table})`)

export type Value = string | number | null | SqlValue

export interface Element {
  table: TableName
  id: number
}

interface Guard {
  condition: string
  params: unknown[]
  code: string
  element?: Element
}

export type WriteOutcome =
  | { ok: true; insertedIds: number[] }
  | { ok: false; status: 409 | 422 | 503; body: ApiError }

const NAME = /^[a-z_]+$/
const COLUMNS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(TABLE_COLUMNS).map(([t, cols]) => [t, new Set<string>(['id', ...cols])]),
)
const TRACE = new Set(['created_by', 'created_at', 'updated_by', 'updated_at', 'row_version'])

function checkColumn(table: TableName, column: string): void {
  if (!NAME.test(column) || !COLUMNS[table]?.has(column) || TRACE.has(column)) {
    throw new Error(`write: unknown column ${table}.${column}`)
  }
}

function expression(value: Value): { sql: string; params: unknown[] } {
  return value instanceof SqlValue ? { sql: value.sql, params: value.params } : { sql: '?', params: [value] }
}

export class WriteBatch {
  private readonly statements: D1PreparedStatement[] = []
  private readonly guards: Guard[] = []
  private readonly inserts: number[] = []

  /**
   * @param author the address read from the verified Access token
   * @param now UTC timestamp of the write, the same for every row of the batch
   * @param restoring only the lots of a restore are written while its marker is set
   */
  constructor(
    private readonly db: D1Database,
    private readonly author: string,
    readonly now: string = new Date().toISOString(),
    restoring = false,
  ) {
    // While a restore runs, every other write is refused (spec 4.3).
    if (!restoring) this.guard('NOT EXISTS (SELECT 1 FROM meta WHERE restore_in_progress = 1)', [], 'restore_in_progress')
  }

  /** The batch is written only if the condition (SQL, true or false) holds when it runs. */
  guard(condition: string, params: unknown[], code: string, element?: Element): this {
    this.guards.push({ condition, params, code, element })
    this.statements.push(
      this.db.prepare(`INSERT INTO write_guard (failed) SELECT 1 WHERE NOT (${condition})`).bind(...params),
    )
    return this
  }

  /** The element is still at the version the app read; else "Modifié entre-temps". */
  expectVersion(table: VersionedTable, id: number, rowVersion: number): this {
    return this.guard(
      `EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND row_version = ?)`,
      [id, rowVersion],
      'conflict',
      { table, id },
    )
  }

  /** Inserts a row; traceability filled in. Its id is in the outcome, in insertion order. */
  insert(table: TableName, values: Record<string, Value>): this {
    const columns = Object.keys(values)
    columns.forEach((c) => checkColumn(table, c))
    const exprs = columns.map((c) => expression(values[c] as Value))
    const sql =
      `INSERT INTO ${table} (${[...columns, 'created_by', 'created_at', 'updated_by', 'updated_at'].join(', ')}) ` +
      `VALUES (${[...exprs.map((e) => e.sql), '?', '?', '?', '?'].join(', ')})`
    const params = [...exprs.flatMap((e) => e.params), this.author, this.now, this.author, this.now]
    this.inserts.push(this.statements.length)
    this.statements.push(this.db.prepare(sql).bind(...params))
    return this
  }

  /**
   * Inserts many rows of the same columns, several per statement (D1 binds at most 100 values
   * per statement): an import writes hundreds of operations in one batch. Their ids are not
   * returned.
   */
  insertRows(table: TableName, columns: string[], rows: (string | number | null)[][]): this {
    columns.forEach((c) => checkColumn(table, c))
    const width = columns.length + 4
    const perStatement = Math.max(1, Math.floor(100 / width))
    const marks = `(${Array.from({ length: width }, () => '?').join(', ')})`
    for (let i = 0; i < rows.length; i += perStatement) {
      const chunk = rows.slice(i, i + perStatement)
      for (const r of chunk) if (r.length !== columns.length) throw new Error('write: row width')
      const sql =
        `INSERT INTO ${table} (${[...columns, 'created_by', 'created_at', 'updated_by', 'updated_at'].join(', ')}) ` +
        `VALUES ${chunk.map(() => marks).join(', ')}`
      const params = chunk.flatMap((r) => [...r, this.author, this.now, this.author, this.now])
      this.statements.push(this.db.prepare(sql).bind(...params))
    }
    return this
  }

  /**
   * Gives each operation imported by this batch, and still without a part, one part to
   * categorize of its whole amount (spec 2.1). One statement, whatever the number of operations.
   */
  partsForImported(): this {
    this.statements.push(
      this.db
        .prepare(
          'INSERT INTO operation_part (operation_id, category_id, amount_cents, created_by, created_at, updated_by, updated_at) ' +
            "SELECT o.id, NULL, o.amount_cents, ?, ?, ?, ? FROM operation o WHERE o.origin = 'import' AND o.created_at = ? " +
            'AND NOT EXISTS (SELECT 1 FROM operation_part p WHERE p.operation_id = o.id) ORDER BY o.id',
        )
        .bind(this.author, this.now, this.author, this.now, this.now),
    )
    return this
  }

  /** Updates a row; its row_version goes up and its last author is set. */
  update(table: VersionedTable, id: number, values: Record<string, Value>): this {
    const columns = Object.keys(values)
    if (columns.length === 0) throw new Error('write: empty update')
    columns.forEach((c) => checkColumn(table, c))
    const exprs = columns.map((c) => expression(values[c] as Value))
    const sets = columns.map((c, i) => `${c} = ${exprs[i]?.sql}`)
    const sql = `UPDATE ${table} SET ${sets.join(', ')}, row_version = row_version + 1, updated_by = ?, updated_at = ? WHERE id = ?`
    this.statements.push(this.db.prepare(sql).bind(...exprs.flatMap((e) => e.params), this.author, this.now, id))
    return this
  }

  /**
   * Raises the row_version of a parent: the budget line when one of its versions or overrides
   * is written, the operation when one of its parts is (spec 4.3).
   */
  touch(table: 'budget_line' | 'operation', id: number): this {
    this.statements.push(
      this.db
        .prepare(`UPDATE ${table} SET row_version = row_version + 1, updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(this.author, this.now, id),
    )
    return this
  }

  /**
   * Erases a part of an operation: the only row ever erased. A part has no history of its own;
   * its operation keeps who changed it and when (DECISIONS.md, 2026-11-25).
   */
  erasePart(id: number): this {
    this.statements.push(this.db.prepare('DELETE FROM operation_part WHERE id = ?').bind(id))
    return this
  }

  /**
   * Archives, in one statement, the rows of a table that are not archived yet and match the
   * condition (e.g. the categories of an archived section). Only sections and categories.
   */
  archiveWhere(table: 'section' | 'category', where: string, params: unknown[]): this {
    this.statements.push(
      this.db
        .prepare(
          `UPDATE ${table} SET archived_at = ?, row_version = row_version + 1, updated_by = ?, updated_at = ? ` +
            `WHERE archived_at IS NULL AND (${where})`,
        )
        .bind(this.now, this.author, this.now, ...params),
    )
    return this
  }

  /**
   * A statement written by this code (meta, the rows of a restore): never SQL from a request,
   * values only as parameters.
   */
  statement(sql: string, params: unknown[] = []): this {
    this.statements.push(this.db.prepare(sql).bind(...params))
    return this
  }

  get size(): number {
    return this.statements.length
  }

  async run(): Promise<WriteOutcome> {
    let results: D1Result[]
    try {
      results = await this.db.batch(this.statements)
    } catch (e) {
      return this.failure(e)
    }
    return { ok: true, insertedIds: this.inserts.map((i) => Number(results[i]?.meta.last_row_id)) }
  }

  private async failure(e: unknown): Promise<WriteOutcome> {
    const message = e instanceof Error ? e.message : ''
    if (message.includes('CHECK constraint failed: guard')) return this.failedGuard()
    // Fixed codes only: a database message may hold values.
    if (message.includes('UNIQUE constraint failed')) return { ok: false, status: 409, body: { error: 'duplicate' } }
    if (message.includes('FOREIGN KEY constraint failed')) return { ok: false, status: 422, body: { error: 'invalid_link' } }
    if (message.includes('constraint failed')) return { ok: false, status: 422, body: { error: 'invalid_value' } }
    throw e
  }

  /** Which guards fail now: the elements changed meanwhile, or the first rule broken. */
  private async failedGuard(): Promise<WriteOutcome> {
    const checks = await this.db.batch<{ ok: number }>(
      this.guards.map((g) => this.db.prepare(`SELECT (${g.condition}) AS ok`).bind(...g.params)),
    )
    const failed = this.guards.filter((_, i) => checks[i]?.results[0]?.ok !== 1)
    if (failed.some((g) => g.code === 'restore_in_progress')) {
      return { ok: false, status: 503, body: { error: 'restore_in_progress' } }
    }
    const changed = failed.filter((g) => g.code === 'conflict' && g.element).map((g) => g.element as Element)
    if (changed.length > 0) return { ok: false, status: 409, body: { error: 'conflict', changed } }
    const rule = failed[0]
    if (rule) return { ok: false, status: 422, body: { error: rule.code } }
    // Changed again since: the conditions hold now. The app reloads and tries again.
    return { ok: false, status: 409, body: { error: 'conflict', changed: [] } }
  }
}
