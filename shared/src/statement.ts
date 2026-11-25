// Reading of a Crédit Agricole statement (spec 4.4, step 2), on the sheet as read-excel-file
// gives it. Pure: the browser reads the file, this turns its cells into the rows sent to the
// Worker. Nothing above the header row leaves the device but the « Solde au » and its date:
// the holders' names and the account number are never read.

import { isIsoDate } from './engine/dates'
import { firstLine, normalizeBankLabel } from './engine/labels'
import type { ImportRow } from './engine/import'
import type { IsoDate } from './engine/model'

/** A cell as read-excel-file gives it, numbers kept as their raw text (parseNumber). */
export type SheetCell = string | number | boolean | Date | null
export type SheetRows = SheetCell[][]

/** The balance printed on the statement (« Solde au JJ/MM/AAAA »). */
export interface StatementBalance {
  date: IsoDate
  balanceCents: number
}

export interface Statement {
  balance: StatementBalance
  /** In the order of the file. */
  rows: ImportRow[]
}

export type StatementError =
  /** No header row with the five columns. */
  | { error: 'no_header' }
  /** No « Solde au » above the header, or not readable. */
  | { error: 'no_balance' }
  /** A row below the header cannot be read: its line number in the sheet (1 for the first). */
  | { error: 'bad_row'; line: number }
  | { error: 'no_rows' }
  | { error: 'too_many_rows'; count: number }

export const HEADERS = ['Date', 'Date valeur', 'Libellé', 'Débit euros', 'Crédit euros'] as const

/**
 * Other titles seen for a column. A real statement of 2026-11-25 titles the first one « Date
 * d'opération » (the one of 2026-10-27 said « Date »): both are read.
 */
const ALIASES: Record<string, string[]> = {
  date: ['date d operation', 'date operation'],
}

/** Longest bank label stored (spec 4.5). */
const MAX_LABEL = 500

/** A title as letters and digits only: accents, apostrophes of any kind, spaces and invisible characters left out. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const text = (c: SheetCell | undefined): string => (typeof c === 'string' ? c : '')

/** 'JJ/MM/AAAA' text, or a date cell read in UTC (never the device's time zone, spec 4.3). */
export function cellDate(c: SheetCell | undefined): IsoDate | null {
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return null
    const iso = c.toISOString().slice(0, 10)
    return isIsoDate(iso) ? iso : null
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text(c).trim())
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  return isIsoDate(iso) ? iso : null
}

/**
 * Euros to integer cents, from a number cell (its raw text, e.g. '12.3' or '1.2E3') or a text
 * cell ('4768,00 €', '4 768,00 €', '-12,5'). No floating point on the way: '0.1' gives 10.
 */
export function cellCents(c: SheetCell | undefined): number | null {
  if (c === null || c === undefined || typeof c === 'boolean' || c instanceof Date) return null
  if (typeof c === 'number') return Number.isFinite(c) ? Math.round(c * 100) : null
  let s = c.replace(/[\s  €]/g, '')
  if (s === '') return null
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) ? Math.round(n * 100) : null
  }
  // A number cell written with binary noise ('69.93000000000001'): the nearest cent, if that close.
  if (/^[+-]?\d+\.\d{3,}$/.test(s)) {
    const n = Number(s) * 100
    const cents = Math.round(n)
    return Math.abs(n - cents) < 1e-6 && Number.isSafeInteger(cents) ? cents : null
  }
  // A comma is the decimal separator in French; a dot then only separates thousands.
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const m = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return null
  return m[1] === '-' ? -cents : cents
}

function findHeader(rows: SheetRows): { line: number; columns: number[] } | null {
  const wanted = HEADERS.map(fold)
  for (let i = 0; i < rows.length; i += 1) {
    const cells = (rows[i] ?? []).map((c) => fold(text(c)))
    const columns = wanted.map((w) => cells.findIndex((c) => c === w || (ALIASES[w] ?? []).includes(c)))
    if (columns.every((c) => c >= 0)) return { line: i, columns }
  }
  return null
}

/** « Solde au JJ/MM/AAAA » and the amount in a following cell of the same row. */
function findBalance(rows: SheetRows, before: number): StatementBalance | null {
  for (let i = 0; i < before; i += 1) {
    const row = rows[i] ?? []
    for (let j = 0; j < row.length; j += 1) {
      const m = /^solde au (\d{2}) (\d{2}) (\d{4})$/.exec(fold(text(row[j])))
      if (!m) continue
      const date = cellDate(`${m[1]}/${m[2]}/${m[3]}`)
      const amount = row.slice(j + 1).find((c) => c !== null && c !== '')
      const balanceCents = cellCents(amount)
      return date !== null && balanceCents !== null ? { date, balanceCents } : null
    }
  }
  return null
}

const isEmpty = (row: SheetCell[] | undefined) => !row || row.every((c) => c === null || (typeof c === 'string' && c.trim() === ''))

/** Reads a statement, or says why it cannot. At most `maxRows` operations. */
export function readStatement(rows: SheetRows, maxRows: number): Statement | StatementError {
  const header = findHeader(rows)
  if (!header) return { error: 'no_header' }
  const balance = findBalance(rows, header.line)
  if (!balance) return { error: 'no_balance' }
  const [date, valueDate, label, debit, credit] = header.columns as [number, number, number, number, number]
  const out: ImportRow[] = []
  for (let i = header.line + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (isEmpty(row)) continue
    const r = row as SheetCell[]
    const opDate = cellDate(r[date])
    const value = cellDate(r[valueDate])
    const raw = firstLine(text(r[label])).trim()
    const d = cellCents(r[debit])
    const c = cellCents(r[credit])
    const hasDebit = d !== null && d !== 0
    const hasCredit = c !== null && c !== 0
    // One of debit or credit, positive, never both (observed on the real export, step 3).
    const amountOk = hasDebit !== hasCredit && (d ?? 0) >= 0 && (c ?? 0) >= 0
    if (!opDate || !value || raw === '' || raw.length > MAX_LABEL || !amountOk) return { error: 'bad_row', line: i + 1 }
    out.push({
      opDate,
      valueDate: value,
      amountCents: (c ?? 0) - (d ?? 0),
      bankLabel: normalizeBankLabel(raw),
      bankLabelRaw: raw,
    })
  }
  if (out.length === 0) return { error: 'no_rows' }
  if (out.length > maxRows) return { error: 'too_many_rows', count: out.length }
  return { balance, rows: out }
}
