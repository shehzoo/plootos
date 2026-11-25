// What the budget lines screen shows (spec 3.6), read only (lot 6): a year grid on a computer,
// one month on a phone, and the record of a line with its history. Pure functions, tested on
// the example month (spec 1.3, 1.4).

import {
  addMonths,
  type BudgetLineVersion,
  type Id,
  type Ledger,
  type Month,
  type Rhythm,
} from '../../../shared/src/engine'
import { MONTH_NAMES, monthName } from '../format'
import { monthBounds, path, rhythmText, type MonthContext } from '../month/view'

/** Short month names of the year grid: « janv. », « févr. »… */
export const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const

export interface BudgetBounds {
  first: Month
  current: Month
  last: Month
}

export function budgetBounds(ctx: MonthContext): BudgetBounds {
  const b = monthBounds(ctx)
  return { first: b.first, current: b.current, last: b.last }
}

/** The month to show for a requested one: outside the bounds, the current month. */
export function clampBudgetMonth(month: Month | null, bounds: BudgetBounds): Month {
  if (month === null || month < bounds.first || month > bounds.last) return bounds.current
  return month
}

/** A line's amount in a month: null when it does not apply; as stored (unsigned). */
export interface LineCell {
  month: Month
  /** Null: the line does not apply that month (a dash on a phone, an empty cell on a computer). */
  amountCents: number | null
  overridden: boolean
  /** Before the current month: greyed, never overridable (spec 3.6). */
  past: boolean
}

export interface LineRow {
  id: Id
  label: string
  /** « Courses > Chats » */
  categoryPath: string
  /** Rhythm of the version in force at the end of the period shown, in words. */
  rhythm: string
  cells: LineCell[]
  /** Overrides after the month shown, not removed. */
  upcomingOverrides: number
}

export interface BudgetSectionView {
  id: Id
  name: string
  lines: LineRow[]
  /** Planned by month, read as an amount (an expense reads positive), like the lines. */
  totals: number[]
}

export interface BudgetView {
  months: Month[]
  sections: BudgetSectionView[]
  /** C3 summed over all categories, signed: the "Prévu du mois" row; null before the first month followed. */
  net: (number | null)[]
}

/** Latest version of a line that is still counted, by start month. */
function versionsOf(ledger: Ledger, lineId: Id): BudgetLineVersion[] {
  return ledger.data.versions.filter((v) => v.budgetLineId === lineId && v.replacedAt === null).sort((a, b) => (a.startMonth < b.startMonth ? -1 : 1))
}

/** Version in force in a month, else the last one that started before it, else the first. */
function versionAround(versions: BudgetLineVersion[], month: Month): BudgetLineVersion | undefined {
  const covering = versions.find((v) => v.startMonth <= month && (v.endMonth === null || month <= v.endMonth))
  if (covering) return covering
  const before = versions.filter((v) => v.startMonth <= month)
  return before[before.length - 1] ?? versions[0]
}

/** « Tous les mois », « Tous les 3 mois, calés sur janvier », « Mois cochés : septembre à juin ». */
export function versionRhythmText(rhythm: Rhythm): string {
  if (rhythm.kind === 'every_n' && rhythm.everyN > 1) {
    const anchor = Number(rhythm.anchorMonth.slice(5, 7))
    return `${rhythmText(rhythm)}, calés sur ${MONTH_NAMES[anchor - 1]}`
  }
  return rhythmText(rhythm)
}

function lineRow(ctx: MonthContext, lineId: Id, months: Month[], current: Month, first: Month, focus: Month): LineRow | null {
  const { ledger, app } = ctx
  const line = ledger.data.budgetLines.find((l) => l.id === lineId)
  const versions = versionsOf(ledger, lineId)
  const version = versionAround(versions, focus)
  if (!line || !version) return null
  const cells: LineCell[] = months.map((m) => {
    // Months before the first one followed have no budget in the app (the year grid starts in January).
    const applied = m < first ? null : ledger.lineInMonth(lineId, m)
    return { month: m, amountCents: applied ? applied.amountCents : null, overridden: applied?.override != null, past: m < current }
  })
  const upcoming = app.overrides.filter((o) => o.budgetLineId === lineId && o.removedAt === null && o.month > focus).length
  return {
    id: lineId,
    label: line.label,
    categoryPath: path(ledger, version.categoryId),
    rhythm: versionRhythmText(version.rhythm),
    cells,
    upcomingOverrides: upcoming,
  }
}

/**
 * The lines of a period (a year on a computer, one month on a phone), grouped by section. A
 * line is listed when one of its versions that still counts covers part of the period, so an
 * archived line stays in the months it was budgeted (R4). `focus` is the month whose version
 * gives the line's category and rhythm.
 */
export function budgetView(ctx: MonthContext, months: Month[], focus: Month): BudgetView {
  const { ledger } = ctx
  const first = months[0] as Month
  const last = months[months.length - 1] as Month
  const { current, first: followed } = monthBounds(ctx)
  const sections: BudgetSectionView[] = []
  for (const section of ledger.data.sections) {
    const roots = ledger.levelOneCategories(section.id)
    const rows: LineRow[] = []
    for (const line of ledger.data.budgetLines) {
      const versions = versionsOf(ledger, line.id)
      const inPeriod = versions.some((v) => v.startMonth <= last && (v.endMonth === null || v.endMonth >= first))
      if (!inPeriod) continue
      const version = versionAround(versions, focus)
      if (!version || ledger.sectionOf(version.categoryId).id !== section.id) continue
      const row = lineRow(ctx, line.id, months, current, followed, focus)
      if (row) rows.push(row)
    }
    const sign = section.direction === 'in' ? 1 : -1
    const totals = months.map((m) => m < followed ? 0 : roots.reduce((sum, c) => sum + sign * ledger.planned(c.id, m), 0))
    if (rows.length === 0 && roots.length === 0) continue
    rows.sort((a, b) => a.categoryPath.localeCompare(b.categoryPath, 'fr') || a.id - b.id)
    sections.push({ id: section.id, name: section.name, lines: rows, totals })
  }
  return { months, sections, net: months.map((m) => (m < followed ? null : ledger.plannedNet(m))) }
}

/** The twelve months of the year of a month. */
export function yearMonths(month: Month): Month[] {
  const start = `${month.slice(0, 4)}-01`
  return Array.from({ length: 12 }, (_, i) => addMonths(start, i))
}

// Record of a line

export interface VersionHistory {
  id: Id
  amountCents: number
  categoryPath: string
  rhythm: string
  /** « depuis mars 2027 », « de janvier 2027 à mai 2027 » */
  period: string
  /** Replaced by a later change (R3, R4): no longer counted. */
  replaced: boolean
  by: string
  on: string
}

export interface OverrideHistory {
  id: Id
  month: Month
  amountCents: number
  reason: string | null
  removed: boolean
  by: string
  on: string
  /** Who removed it, and when (its last author, spec 4.5). */
  removedBy: string
  removedOn: string
}

export interface LineRecord {
  id: Id
  label: string
  categoryPath: string
  /** The version in force in the current month, else the latest one. */
  amountCents: number
  rhythm: string
  period: string
  /** Last month of an archived line. */
  archived: boolean
  versions: VersionHistory[]
  overrides: OverrideHistory[]
}

const monthLabel = (m: Month) => `${monthName(m)} ${m.slice(0, 4)}`

function periodText(v: Pick<BudgetLineVersion, 'startMonth' | 'endMonth'>): string {
  return v.endMonth === null ? `depuis ${monthLabel(v.startMonth)}` : `de ${monthLabel(v.startMonth)} à ${monthLabel(v.endMonth)}`
}

export function lineRecord(ctx: MonthContext, lineId: Id): LineRecord | null {
  const { ledger, app } = ctx
  const line = app.budgetLines.find((l) => l.id === lineId)
  if (!line) return null
  const stored = app.versions.filter((v) => v.budgetLineId === lineId).sort((a, b) => (a.startMonth < b.startMonth ? -1 : a.startMonth > b.startMonth ? 1 : a.id - b.id))
  const counted = stored.filter((v) => v.replacedAt === null)
  if (counted.length === 0 && stored.length === 0) return null
  const current = monthBounds(ctx).current
  const shown = versionAround(counted.length > 0 ? counted : stored, current) as BudgetLineVersion
  return {
    id: lineId,
    label: line.label,
    categoryPath: path(ledger, shown.categoryId),
    amountCents: shown.amountCents,
    rhythm: versionRhythmText(shown.rhythm),
    period: periodText(shown),
    archived: shown.endMonth !== null && shown.endMonth < current,
    versions: stored.map((v) => ({
      id: v.id,
      amountCents: v.amountCents,
      categoryPath: path(ledger, v.categoryId),
      rhythm: versionRhythmText(v.rhythm),
      period: periodText(v),
      replaced: v.replacedAt !== null,
      by: v.createdBy,
      on: v.createdAt.slice(0, 10),
    })),
    overrides: app.overrides
      .filter((o) => o.budgetLineId === lineId)
      .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.id - b.id))
      .map((o) => ({
        id: o.id,
        month: o.month,
        amountCents: o.amountCents,
        reason: o.reason,
        removed: o.removedAt !== null,
        by: o.createdBy,
        on: o.createdAt.slice(0, 10),
        removedBy: o.updatedBy,
        removedOn: (o.removedAt ?? o.updatedAt).slice(0, 10),
      })),
  }
}
