// Decoding of GET /api/data into the model of the calculation engine, with the traceability
// fields kept beside it (spec 2.1: created by, created on, modified by, modified on).

import type { DataResponse, Row } from './api'
import type {
  BudgetData,
  BudgetLine,
  BudgetLineVersion,
  BudgetOverride,
  Category,
  Id,
  IsoDate,
  OpeningBalance,
  Operation,
  OperationPart,
  Rhythm,
  Section,
} from './engine/model'

export interface Trace {
  /** First name of the author ('?' if the address is no longer an allowed one). */
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export interface Versioned {
  /** Sent back with a write: the server refuses it if the element changed meanwhile (spec 4.3). */
  rowVersion: number
}

export type Stored<T> = T & Trace & Versioned

export interface BalanceCheck extends Trace {
  id: Id
  checkDate: IsoDate
  bankBalanceCents: number
  /** App balance minus bank balance, as found that day. */
  gapCents: number
}

export interface AppData {
  sections: Stored<Section>[]
  categories: Stored<Category>[]
  budgetLines: Stored<BudgetLine>[]
  versions: Stored<BudgetLineVersion>[]
  overrides: Stored<BudgetOverride>[]
  operations: Stored<Operation>[]
  parts: Stored<OperationPart>[]
  /** Null until the app is set up (spec 3.8). */
  openingBalance: Stored<OpeningBalance> | null
  balanceChecks: BalanceCheck[]
}

const str = (v: unknown) => v as string
const num = (v: unknown) => v as number
const optStr = (v: unknown) => (v ?? null) as string | null
const optNum = (v: unknown) => (v ?? null) as number | null

function trace(r: Row, at: number): Trace {
  return { createdBy: str(r[at]), createdAt: str(r[at + 1]), updatedBy: str(r[at + 2]), updatedAt: str(r[at + 3]) }
}

function rhythm(kind: unknown, everyN: unknown, anchorMonth: unknown, months: unknown): Rhythm {
  if (kind === 'every_n') return { kind: 'every_n', everyN: num(everyN), anchorMonth: str(anchorMonth) }
  return { kind: 'months', months: str(months).split(',').map(Number) }
}

/** Rows in the column order of TABLE_COLUMNS (shared/src/api.ts). */
export function decodeData(res: DataResponse): AppData {
  const t = res.tables
  const ob = t.opening_balance[0]
  return {
    sections: t.section.map((r) => ({
      id: num(r[0]),
      name: str(r[1]),
      direction: r[2] as Section['direction'],
      sortOrder: num(r[3]),
      archivedAt: optStr(r[4]),
      rowVersion: num(r[5]),
      ...trace(r, 6),
    })),
    categories: t.category.map((r) => ({
      id: num(r[0]),
      name: str(r[1]),
      parentId: optNum(r[2]),
      sectionId: optNum(r[3]),
      sortOrder: num(r[4]),
      archivedAt: optStr(r[5]),
      rowVersion: num(r[6]),
      ...trace(r, 7),
    })),
    budgetLines: t.budget_line.map((r) => ({ id: num(r[0]), label: str(r[1]), rowVersion: num(r[2]), ...trace(r, 3) })),
    versions: t.budget_line_version.map((r) => ({
      id: num(r[0]),
      budgetLineId: num(r[1]),
      categoryId: num(r[2]),
      amountCents: num(r[3]),
      startMonth: str(r[4]),
      endMonth: optStr(r[5]),
      replacedAt: optStr(r[6]),
      rhythm: rhythm(r[7], r[8], r[9], r[10]),
      rowVersion: num(r[11]),
      ...trace(r, 12),
    })),
    overrides: t.budget_override.map((r) => ({
      id: num(r[0]),
      budgetLineId: num(r[1]),
      month: str(r[2]),
      amountCents: num(r[3]),
      reason: optStr(r[4]),
      removedAt: optStr(r[5]),
      rowVersion: num(r[6]),
      ...trace(r, 7),
    })),
    operations: t.operation.map((r) => ({
      id: num(r[0]),
      opDate: str(r[1]),
      valueDate: str(r[2]),
      amountCents: num(r[3]),
      origin: r[4] as Operation['origin'],
      bankLabel: optStr(r[5]),
      bankLabelRaw: optStr(r[6]),
      dupRank: optNum(r[7]),
      comment: optStr(r[8]),
      archivedAt: optStr(r[9]),
      rowVersion: num(r[10]),
      ...trace(r, 11),
    })),
    parts: t.operation_part.map((r) => ({
      id: num(r[0]),
      operationId: num(r[1]),
      categoryId: optNum(r[2]),
      amountCents: num(r[3]),
      rowVersion: num(r[4]),
      ...trace(r, 5),
    })),
    openingBalance: ob
      ? { balanceDate: str(ob[0]), amountCents: num(ob[1]), rowVersion: num(ob[2]), ...trace(ob, 3) }
      : null,
    balanceChecks: t.balance_check.map((r) => ({
      id: num(r[0]),
      checkDate: str(r[1]),
      bankBalanceCents: num(r[2]),
      gapCents: num(r[3]),
      ...trace(r, 4),
    })),
  }
}

/** What the calculation engine reads; null until the app is set up (no opening balance). */
export function budgetData(app: AppData): BudgetData | null {
  if (!app.openingBalance) return null
  return {
    sections: app.sections,
    categories: app.categories,
    budgetLines: app.budgetLines,
    versions: app.versions,
    overrides: app.overrides,
    operations: app.operations,
    parts: app.parts,
    openingBalance: app.openingBalance,
  }
}
