// Data read by the calculation engine. Each shape mirrors a table of spec 4.5, with only the
// columns the calculations need (traceability columns are left to the storage layer).
// Amounts are integer cents; months are 'YYYY-MM'; dates are 'YYYY-MM-DD' (spec 4.3, 4.5).

export type Id = number
/** 'YYYY-MM' */
export type Month = string
/** 'YYYY-MM-DD' */
export type IsoDate = string

export type Direction = 'in' | 'out'

export interface Section {
  id: Id
  name: string
  direction: Direction
  sortOrder: number
  archivedAt: string | null
}

export interface Category {
  id: Id
  name: string
  /** Empty at level 1. */
  parentId: Id | null
  /** Level 1 only. */
  sectionId: Id | null
  sortOrder: number
  archivedAt: string | null
}

export interface BudgetLine {
  id: Id
  label: string
}

/** Rhythm of a version: every N months from an anchor month, or ticked months of the year. */
export type Rhythm =
  | { kind: 'every_n'; everyN: number; anchorMonth: Month }
  | { kind: 'months'; months: number[] }

export interface BudgetLineVersion {
  id: Id
  budgetLineId: Id
  categoryId: Id
  /** Always positive; the sign comes from the section's direction. */
  amountCents: number
  startMonth: Month
  /** Empty while the version runs. */
  endMonth: Month | null
  /** Set when a later change replaced this version (R3, R4): it no longer counts. */
  replacedAt: string | null
  rhythm: Rhythm
}

export interface BudgetOverride {
  id: Id
  budgetLineId: Id
  month: Month
  /** 0 or more; 0 cancels the line that month, which still applies at 0. */
  amountCents: number
  reason: string | null
  removedAt: string | null
}

export interface Operation {
  id: Id
  opDate: IsoDate
  valueDate: IsoDate
  /** Signed: + money in, - money out, as on the statement. */
  amountCents: number
  origin: 'import' | 'manual'
  /** Normalized first line of the bank label (import only). */
  bankLabel: string | null
  bankLabelRaw: string | null
  /** Rank among identical imported operations (spec 4.4). */
  dupRank: number | null
  comment: string | null
  /** Only a deleted manual operation is archived: it leaves every calculation. */
  archivedAt: string | null
}

export interface OperationPart {
  id: Id
  operationId: Id
  /** Empty while the operation is to be categorized. */
  categoryId: Id | null
  /** Signed like its operation. */
  amountCents: number
}

export interface OpeningBalance {
  balanceDate: IsoDate
  amountCents: number
}

export interface BudgetData {
  sections: Section[]
  categories: Category[]
  budgetLines: BudgetLine[]
  versions: BudgetLineVersion[]
  overrides: BudgetOverride[]
  operations: Operation[]
  parts: OperationPart[]
  openingBalance: OpeningBalance
}
