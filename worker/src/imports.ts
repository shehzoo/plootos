// Lot 10: import of a statement and balance check (spec 3.2, 4.4, U8, R6, R8, R9).
//
// Import, in two requests. « preview » sorts the rows (shared function sortImport) against the
// operations of the same value dates, and gives C7 at the statement date. « import » sorts
// again: if the sort changed meanwhile (an entry, another import), nothing is written and the
// new sort is sent back. Otherwise one all-or-nothing batch writes the new operations, the
// merges and the balance check; guards make sure nothing the sort and the balance depend on
// changed between this reading and the write. Two crossing imports never store an operation
// twice: the database refuses the same (date, value date, amount, label, rank) twice.
//
// The balance check (C7) uses the engine's own rule (balanceOf), on totals by value date.

import { Hono } from 'hono'
import {
  MAX_IMPORT_ROWS,
  type ApiError,
  type BalanceCheckResult,
  type ImportChanged,
  type ImportPreview,
  type ImportResult,
} from '../../shared/src/api'
import { isIsoDate } from '../../shared/src/engine/dates'
import { checkMergePairs, importBalanceGap, sortImport, type ImportRow, type ImportSort, type MergePair } from '../../shared/src/engine/import'
import { normalizeBankLabel } from '../../shared/src/engine/labels'
import { balanceOf } from '../../shared/src/engine/ledger'
import type { Operation, OpeningBalance } from '../../shared/src/engine/model'
import { all, BadRequest, catalogBatch, fail, first, integer, MAX_CENTS, readBody, route, type C } from './request'
import { serverToday } from './today'
import type { AppEnv } from './types'
import type { WriteBatch } from './write'

const MAX_ID = 1_000_000_000
const MAX_LABEL = 500

interface Statement {
  balance: { date: string; balanceCents: number }
  rows: ImportRow[]
}

function dateOf(v: unknown, reason: string): string {
  if (typeof v !== 'string' || !isIsoDate(v)) throw new BadRequest(reason)
  return v
}

function statementOf(b: Record<string, unknown>): Statement {
  const balance = (b.balance ?? {}) as Record<string, unknown>
  if (!Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > MAX_IMPORT_ROWS) throw new BadRequest('rows')
  const rows = b.rows.map((x): ImportRow => {
    const r = (x ?? {}) as Record<string, unknown>
    const raw = r.bankLabelRaw
    if (typeof raw !== 'string' || /[\r\n]/.test(raw) || raw.length > MAX_LABEL) throw new BadRequest('label')
    // The Worker normalizes the label itself, with the app's function (R8).
    const bankLabel = normalizeBankLabel(raw)
    if (bankLabel === '') throw new BadRequest('label')
    const amountCents = integer(r.amountCents, 'amount', -MAX_CENTS, MAX_CENTS)
    if (amountCents === 0) throw new BadRequest('amount')
    return { opDate: dateOf(r.opDate, 'date'), valueDate: dateOf(r.valueDate, 'date'), amountCents, bankLabel, bankLabelRaw: raw }
  })
  return {
    balance: { date: dateOf(balance.date, 'balance'), balanceCents: integer(balance.balanceCents, 'balance', -MAX_CENTS, MAX_CENTS) },
    rows,
  }
}

interface OperationRow {
  id: number
  op_date: string
  value_date: string
  amount_cents: number
  origin: 'import' | 'manual'
  bank_label: string | null
  dup_rank: number | null
  archived_at: string | null
  row_version: number
}

/** What a balance (C7) at a date depends on, read once: the guards check it is unchanged. */
interface BalanceReading {
  opening: OpeningBalance
  /** Active operations valued after the opening balance, up to the date: their sum. */
  sumCents: number
  appBalanceCents: number
}

async function openingOf(c: C): Promise<OpeningBalance | null> {
  const row = await first<{ balance_date: string; amount_cents: number }>(c, 'SELECT balance_date, amount_cents FROM opening_balance')
  return row ? { balanceDate: row.balance_date, amountCents: row.amount_cents } : null
}

/** C7 at a date, with the engine's rule, on totals by value date. */
async function readBalance(c: C, opening: OpeningBalance, date: string): Promise<BalanceReading> {
  const totals = await all<{ value_date: string; total: number }>(
    c,
    'SELECT value_date, sum(amount_cents) AS total FROM operation WHERE archived_at IS NULL AND value_date > ? AND value_date <= ? GROUP BY value_date',
    opening.balanceDate,
    date,
  )
  const appBalanceCents = balanceOf(
    opening,
    totals.map((t) => ({ valueDate: t.value_date, amountCents: t.total })),
    date,
  )
  return { opening, sumCents: appBalanceCents - opening.amountCents, appBalanceCents }
}

/** The balance read is still the one in the database when the batch runs. */
function guardBalance(w: WriteBatch, reading: BalanceReading, date: string, code: string): void {
  w.guard('EXISTS (SELECT 1 FROM opening_balance WHERE balance_date = ? AND amount_cents = ?)', [reading.opening.balanceDate, reading.opening.amountCents], code)
  w.guard(
    '(SELECT coalesce(sum(amount_cents), 0) FROM operation WHERE archived_at IS NULL AND value_date > ? AND value_date <= ?) = ?',
    [reading.opening.balanceDate, date, reading.sumCents],
    code,
  )
}

interface Sorted {
  statement: Statement
  sort: ImportSort
  balance: BalanceReading
  /** Value dates of the rows, and the state of the operations valued within them. */
  range: { from: string; to: string; snapshot: string }
  preview: ImportPreview
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Sorts the rows against the operations stored now (R6, R8, R9), and reads C7 at the statement date. */
async function sortStatement(c: C, statement: Statement, opening: OpeningBalance): Promise<Sorted> {
  const dates = statement.rows.map((r) => r.valueDate).sort()
  const from = dates[0] as string
  const to = dates[dates.length - 1] as string
  // R8 and R9 compare rows with operations of the same value date only.
  const [stored, balance] = await Promise.all([
    all<OperationRow>(
      c,
      'SELECT id, op_date, value_date, amount_cents, origin, bank_label, dup_rank, archived_at, row_version FROM operation WHERE value_date BETWEEN ? AND ?',
      from,
      to,
    ),
    readBalance(c, opening, statement.balance.date),
  ])
  const operations: Operation[] = stored.map((o) => ({
    id: o.id,
    opDate: o.op_date,
    valueDate: o.value_date,
    amountCents: o.amount_cents,
    origin: o.origin,
    bankLabel: o.bank_label,
    bankLabelRaw: null,
    dupRank: o.dup_rank,
    comment: null,
    archivedAt: o.archived_at,
  }))
  const sort = sortImport(statement.rows, operations, opening.balanceDate)
  const snapshot = `${stored.length}|${stored.reduce((s, o) => s + o.row_version, 0)}`
  const sorted = {
    excluded: sort.excluded,
    alreadyPresent: sort.alreadyPresent,
    toMerge: sort.toMerge,
    fresh: sort.fresh,
    appBalanceCents: balance.appBalanceCents,
  }
  const token = await sha256(JSON.stringify({ statement, sorted, ranks: [...sort.dupRank], snapshot }))
  return { statement, sort, balance, range: { from, to, snapshot }, preview: { ...sorted, token } }
}

function pairsOf(v: unknown, rowCount: number): MergePair[] {
  if (!Array.isArray(v) || v.length > rowCount) throw new BadRequest('pairs')
  return v.map((x) => {
    const p = (x ?? {}) as Record<string, unknown>
    return { rowIndex: integer(p.rowIndex, 'pairs', 0, rowCount - 1), operationId: integer(p.operationId, 'pairs', 1, MAX_ID) }
  })
}

const changed = (c: C, preview: ImportPreview) => c.json({ error: 'import_changed', preview } satisfies ImportChanged, 409)

export const imports = new Hono<AppEnv>()


// Spec 4.4, step 3: the sort, before the person confirms the merges.
imports.post(
  '/api/import/preview',
  route(async (c) => {
    const statement = statementOf(await readBody(c))
    const opening = await openingOf(c)
    if (!opening) return fail(c, 422, 'not_set_up')
    return c.json((await sortStatement(c, statement, opening)).preview)
  }),
)

// Spec 4.4, steps 5 and 6: sort again, write everything or nothing, then the balance check.
imports.post(
  '/api/import',
  route(async (c) => {
    const b = await readBody(c)
    const statement = statementOf(b)
    if (typeof b.token !== 'string' || b.token.length > 100) throw new BadRequest('token')
    const pairs = pairsOf(b.pairs, statement.rows.length)
    const opening = await openingOf(c)
    if (!opening) return fail(c, 422, 'not_set_up')

    const sorted = await sortStatement(c, statement, opening)
    if (sorted.preview.token !== b.token) return changed(c, sorted.preview)
    if (!checkMergePairs(sorted.sort, pairs)) throw new BadRequest('pairs')

    const { sort, range, balance } = sorted
    const rows = statement.rows
    const w = catalogBatch(c)
    // Nothing the sort depends on changed since it was read; the balance neither.
    w.guard(
      "(SELECT count(*) || '|' || coalesce(sum(row_version), 0) FROM operation WHERE value_date BETWEEN ? AND ?) = ?",
      [range.from, range.to, range.snapshot],
      'import_changed',
    )
    guardBalance(w, balance, statement.balance.date, 'import_changed')

    // Merges (R9): the manual entry takes the bank's fields and becomes an imported operation;
    // it keeps its category and comment (spec 4.4).
    const merged = new Map(pairs.map((p) => [p.rowIndex, p.operationId]))
    for (const [rowIndex, operationId] of merged) {
      const row = rows[rowIndex] as ImportRow
      w.update('operation', operationId, {
        op_date: row.opDate,
        value_date: row.valueDate,
        amount_cents: row.amountCents,
        origin: 'import',
        bank_label: row.bankLabel,
        bank_label_raw: row.bankLabelRaw,
        dup_rank: sort.dupRank.get(rowIndex) ?? 1,
      })
    }
    // New operations, to categorize: the rows of a group left without a pair too.
    const written = [...sort.fresh, ...sort.toMerge.flatMap((g) => g.rowIndexes).filter((i) => !merged.has(i))].sort((a, b) => a - b)
    w.insertRows(
      'operation',
      ['op_date', 'value_date', 'amount_cents', 'origin', 'bank_label', 'bank_label_raw', 'dup_rank'],
      written.map((i) => {
        const r = rows[i] as ImportRow
        return [r.opDate, r.valueDate, r.amountCents, 'import', r.bankLabel, r.bankLabelRaw, sort.dupRank.get(i) ?? 1]
      }),
    )
    if (written.length > 0) w.partsForImported()

    // Balance check (U8), at the statement date: the gap once the rows are written.
    const gapCents = importBalanceGap(() => balance.appBalanceCents, rows, sort, pairs, statement.balance)
    w.insert('balance_check', { check_date: statement.balance.date, bank_balance_cents: statement.balance.balanceCents, gap_cents: gapCents })

    const out = await w.run()
    if (!out.ok) {
      // Changed between the sort and the write: the new sort.
      if (out.body.error === 'import_changed' || out.body.error === 'duplicate' || out.body.error === 'conflict') {
        return changed(c, (await sortStatement(c, statement, opening)).preview)
      }
      return c.json(out.body satisfies ApiError, out.status)
    }
    const body: ImportResult = {
      ok: true,
      imported: written.length,
      merged: pairs.length,
      check: { id: out.insertedIds[0] as number, date: statement.balance.date, bankBalanceCents: statement.balance.balanceCents, gapCents },
    }
    return c.json(body)
  }),
)

// « Vérifier le solde » (spec 3.2, U8): the bank's balance today; the Worker computes and keeps the gap.
imports.post(
  '/api/balance-checks',
  route(async (c) => {
    const b = await readBody(c)
    const bankBalanceCents = integer(b.bankBalanceCents, 'balance', -MAX_CENTS, MAX_CENTS)
    const opening = await openingOf(c)
    if (!opening) return fail(c, 422, 'not_set_up')
    const today = serverToday(c).today
    // Another write may land between the reading and the check: read again, once.
    for (let attempt = 0; ; attempt += 1) {
      const balance = await readBalance(c, opening, today)
      const gapCents = balance.appBalanceCents - bankBalanceCents
      const w = catalogBatch(c)
      guardBalance(w, balance, today, 'balance_changed')
      w.insert('balance_check', { check_date: today, bank_balance_cents: bankBalanceCents, gap_cents: gapCents })
      const out = await w.run()
      if (!out.ok && out.body.error === 'balance_changed' && attempt === 0) continue
      if (!out.ok) return c.json(out.body satisfies ApiError, out.status === 422 ? 409 : out.status)
      const body: BalanceCheckResult = { ok: true, check: { id: out.insertedIds[0] as number, date: today, bankBalanceCents, gapCents } }
      return c.json(body)
    }
  }),
)
