// What the month screens show (spec 3.1 and 3.4), computed from the engine: pure functions,
// tested on the example month (spec 1.3). The components only lay these figures out.
//
// Amounts here are "as read": planned and actual multiplied by s (+1 income, -1 expense), so
// that a spending of 210 € reads 210 €. Remainders (C5) and gaps (C6) come from the engine.

import {
  addMonths,
  lastDayOfMonth,
  monthOf,
  type BudgetStatus,
  type Category,
  type Direction,
  type Id,
  type IsoDate,
  type Ledger,
  type Month,
  type Operation,
  type Rhythm,
} from '../../../shared/src/engine'
import type { AppData, BalanceCheck } from '../../../shared/src/wire'
import { count, euros, eurosArePlural, MONTH_NAMES, monthName, shortDate } from '../format'

export type MonthKind = 'current' | 'future' | 'closed'

export interface MonthContext {
  ledger: Ledger
  app: AppData
  /** Paris time, or the simulated date (local and staging only). */
  today: IsoDate
  /** UTC timestamp of the last export, null if none; left out, no reminder (spec 3.8). */
  lastExportAt?: string | null
}

export interface MonthBounds {
  /** First month followed: the one after the opening balance (spec 3.1). */
  first: Month
  current: Month
  /** December of year N+3, the end of the projection. */
  last: Month
}

export function monthBounds(ctx: MonthContext): MonthBounds {
  const current = monthOf(ctx.today)
  const opening = ctx.ledger.data.openingBalance.balanceDate
  const openingMonth = monthOf(opening)
  const afterOpening = opening === lastDayOfMonth(openingMonth) ? addMonths(openingMonth, 1) : openingMonth
  return {
    first: afterOpening < current ? afterOpening : current,
    current,
    last: `${Number(current.slice(0, 4)) + 3}-12`,
  }
}

export function kindOf(month: Month, bounds: MonthBounds): MonthKind {
  if (month === bounds.current) return 'current'
  return month > bounds.current ? 'future' : 'closed'
}

/** The month to show for a requested one: outside the bounds, the current month. */
export function clampMonth(month: Month | null, bounds: MonthBounds): Month {
  if (month === null || month < bounds.first || month > bounds.last) return bounds.current
  return month
}

// Remainder (current month, C5) and gap (closed month, C6), as words.

export type Remainder =
  | { kind: 'amount'; cents: number }
  | { kind: 'settled' }
  | { kind: 'over'; cents: number }
  | { kind: 'extra'; cents: number }
  | { kind: 'cancelled' }
  | { kind: 'off_budget' }
  | { kind: 'none' }

export function remainderText(r: Remainder): string {
  switch (r.kind) {
    case 'amount':
      return euros(r.cents)
    case 'settled':
      return 'soldé'
    case 'over':
      return `dépassé de ${euros(r.cents)}`
    case 'extra':
      return `reçu en plus ${euros(r.cents)}`
    case 'cancelled':
      return 'annulée ce mois'
    case 'off_budget':
      return 'hors budget'
    case 'none':
      return ''
  }
}

export interface Gap {
  /** C6: positive is more than planned. */
  cents: number
  /** Spent more, or received less. */
  bad: boolean
}

/** « 425 € dépensés en moins », « 12 € dépensés en plus », « 1 € reçu en moins »; empty when nil. */
export function gapText(gap: Gap | null, direction: Direction): string {
  if (gap === null || gap.cents === 0) return ''
  const s = eurosArePlural(gap.cents) ? 's' : ''
  const verb = direction === 'out' ? `dépensé${s}` : `reçu${s}`
  return `${euros(gap.cents)} ${verb} ${gap.cents > 0 ? 'en plus' : 'en moins'}`
}

/** Gap of the balance of a month (C11): « 398 € de mieux », « 40 € de moins ». */
export function monthGapText(cents: number): string {
  if (cents === 0) return 'comme prévu'
  return `${euros(cents)} ${cents > 0 ? 'de mieux' : 'de moins'}`
}

// Rows

export interface CategoryRow {
  /** The category; for a "(sans détail)" row, its level-1 category. */
  id: Id
  name: string
  level: 1 | 2
  /** Parts categorized at level 1 of a category that has subcategories (R2). */
  withoutDetail: boolean
  status: BudgetStatus
  /** Name of the level-1 category when the row is « dans Courses ». */
  withinName: string | null
  direction: Direction
  plannedCents: number
  actualCents: number
  /** Current month. */
  remainder: Remainder
  /** Current month, level 1 only: share of the planned already spent or received. */
  progress: { ratio: number; over: boolean } | null
  /** Closed month: level-1 categories and budgeted subcategories. */
  gap: Gap | null
  /** Phone: overruns of the subcategories, shown on the row of their category. */
  subOverruns: { name: string; text: string }[]
  children: CategoryRow[]
}

export interface SectionView {
  id: Id
  name: string
  direction: Direction
  /** At least one category with an applicable line this month. */
  budgeted: boolean
  plannedCents: number
  actualCents: number
  rows: CategoryRow[]
  /** Summary beside the section, in pieces joined by commas; `over` pieces in the over colour. */
  summary: { text: string; over: boolean }[]
}

interface DirectParts {
  count: number
  cents: number
}

const byOrder = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'fr')

/** Categorized parts of the month, by the category they are attached to (no roll-up). */
function directParts(ledger: Ledger, month: Month): Map<Id, DirectParts> {
  const map = new Map<Id, DirectParts>()
  for (const o of ledger.monthOperations(month)) {
    for (const p of ledger.partsOf(o.id)) {
      if (p.categoryId === null) continue
      const d = map.get(p.categoryId) ?? { count: 0, cents: 0 }
      d.count += 1
      d.cents += p.amountCents
      map.set(p.categoryId, d)
    }
  }
  return map
}

/** Every applicable line of the category is overridden at 0 € this month, and nothing was spent. */
function isCancelled(ledger: Ledger, id: Id, month: Month): boolean {
  const c = ledger.category(id)
  const lines = ledger
    .appliedLines(month)
    .filter((l) => l.categoryId === id || (c.parentId === null && ledger.root(l.categoryId).id === id))
  return lines.length > 0 && lines.every((l) => l.override !== null && l.override.amountCents === 0) && ledger.actual(id, month) === 0
}

function remainderOf(ledger: Ledger, id: Id, month: Month, direction: Direction): Remainder {
  const r = ledger.remaining(id, month)
  if (r === null) return ledger.category(id).parentId === null && ledger.status(id, month) === 'off_budget' ? { kind: 'off_budget' } : { kind: 'none' }
  if (isCancelled(ledger, id, month)) return { kind: 'cancelled' }
  if (r < 0) return direction === 'out' ? { kind: 'over', cents: -r } : { kind: 'extra', cents: -r }
  if (r === 0) return { kind: 'settled' }
  return { kind: 'amount', cents: r }
}

function gapOf(ledger: Ledger, id: Id, month: Month, direction: Direction): Gap {
  const cents = ledger.gap(id, month)
  return { cents, bad: direction === 'out' ? cents > 0 : cents < 0 }
}

function row(ctx: MonthContext, month: Month, kind: MonthKind, c: Category, parts: Map<Id, DirectParts>): CategoryRow | null {
  const { ledger } = ctx
  const level = c.parentId === null ? 1 : 2
  const s = ledger.sign(c.id)
  const direction: Direction = s > 0 ? 'in' : 'out'
  const status = ledger.status(c.id, month)
  const hasParts = (parts.get(c.id)?.count ?? 0) > 0
  if (kind === 'future') {
    if (status !== 'budgeted') return null
  } else if (level === 1 ? status === 'none' : !(status === 'budgeted' || hasParts)) {
    return null
  }
  const plannedCents = s * ledger.planned(c.id, month) || 0
  const actualCents = kind === 'future' ? 0 : s * ledger.actual(c.id, month) || 0
  const remainder = kind === 'current' ? remainderOf(ledger, c.id, month, direction) : { kind: 'none' as const }
  let progress: CategoryRow['progress'] = null
  if (kind === 'current' && level === 1 && (remainder.kind === 'amount' || remainder.kind === 'over' || remainder.kind === 'extra')) {
    const ratio = plannedCents > 0 ? Math.max(0, Math.min(1, actualCents / plannedCents)) : actualCents > 0 ? 1 : 0
    progress = { ratio, over: remainder.kind === 'over' }
  }
  const gap =
    kind === 'closed' && (level === 1 ? status === 'budgeted' || status === 'off_budget' : status === 'budgeted')
      ? gapOf(ledger, c.id, month, direction)
      : null
  return {
    id: c.id,
    name: c.name,
    level,
    withoutDetail: false,
    status,
    withinName: status === 'within' && c.parentId !== null ? ledger.category(c.parentId).name : null,
    direction,
    plannedCents,
    actualCents,
    remainder,
    progress,
    gap,
    subOverruns: [],
    children: [],
  }
}

function withChildren(ctx: MonthContext, month: Month, kind: MonthKind, top: CategoryRow, parts: Map<Id, DirectParts>): CategoryRow {
  const { ledger } = ctx
  const subs = [...ledger.children(top.id)].sort(byOrder)
  top.children = subs.map((c) => row(ctx, month, kind, c, parts)).filter((r): r is CategoryRow => r !== null)
  const direct = parts.get(top.id)
  if (kind !== 'future' && subs.length > 0 && direct && direct.count > 0) {
    top.children.push({
      ...top,
      name: `${top.name} (sans détail)`,
      level: 2,
      withoutDetail: true,
      status: top.status === 'budgeted' ? 'within' : 'off_budget',
      withinName: top.status === 'budgeted' ? top.name : null,
      plannedCents: 0,
      actualCents: ledger.sign(top.id) * direct.cents || 0,
      remainder: { kind: 'none' },
      progress: null,
      gap: null,
      subOverruns: [],
      children: [],
    })
  }
  // Phone: an overrun of a subcategory shows on the row of its category, unless the category
  // itself is over (spec 3.1, 3.4).
  if (kind === 'current' && top.remainder.kind !== 'over') {
    top.subOverruns = top.children
      .filter((r) => r.remainder.kind === 'over')
      .map((r) => ({ name: r.name, text: remainderText(r.remainder) }))
  }
  if (kind === 'closed' && !top.gap?.bad) {
    top.subOverruns = top.children
      .filter((r) => r.gap?.bad && r.gap.cents !== 0)
      .map((r) => ({ name: r.name, text: gapText(r.gap, r.direction) }))
  }
  return top
}

function overrunsText(n: number, cents: number): string {
  return `${n} dépassement${n > 1 ? 's' : ''} (${euros(cents)})`
}

export function sections(ctx: MonthContext, month: Month, kind: MonthKind): SectionView[] {
  const { ledger } = ctx
  const parts = kind === 'future' ? new Map<Id, DirectParts>() : directParts(ledger, month)
  const out: SectionView[] = []
  for (const section of [...ledger.data.sections].sort(byOrder)) {
    const rows = [...ledger.levelOneCategories(section.id)]
      .sort(byOrder)
      .map((c) => row(ctx, month, kind, c, parts))
      .filter((r): r is CategoryRow => r !== null)
      .map((r) => withChildren(ctx, month, kind, r, parts))
    if (rows.length === 0) continue
    const s = section.direction === 'in' ? 1 : -1
    const budgeted = rows.some((r) => r.status === 'budgeted')
    const summary: SectionView['summary'] = []
    if (kind === 'current') {
      const r = ledger.sectionRemaining(section.id, month)
      if (budgeted) summary.push({ text: r.remainingCents > 0 ? `reste ${euros(r.remainingCents)}` : 'soldé', over: false })
      if (r.overrunCount > 0) summary.push({ text: overrunsText(r.overrunCount, r.overrunCents), over: true })
      if (r.extraReceivedCents > 0) summary.push({ text: `reçu en plus ${euros(r.extraReceivedCents)}`, over: false })
      if (r.offBudgetActualCents !== 0) summary.push({ text: `hors budget ${euros(s * r.offBudgetActualCents)}`, over: false })
    } else if (kind === 'closed') {
      const gap = ledger.sectionGap(section.id, month)
      const text = gapText({ cents: gap, bad: false }, section.direction)
      if (text) summary.push({ text, over: false })
      if (section.direction === 'out') {
        // As in C10: one per overrun category, else one per overrun subcategory.
        let n = 0
        let cents = 0
        for (const r of rows) {
          if (r.status !== 'budgeted') continue
          if (r.gap && r.gap.cents > 0) {
            n += 1
            cents += r.gap.cents
            continue
          }
          for (const sub of r.children) {
            if (sub.gap && sub.gap.cents > 0) {
              n += 1
              cents += sub.gap.cents
            }
          }
        }
        if (n > 0) summary.push({ text: overrunsText(n, cents), over: true })
      }
      const offBudget = rows.filter((r) => r.status === 'off_budget').reduce((sum, r) => sum + r.actualCents, 0)
      if (offBudget !== 0) summary.push({ text: `hors budget ${euros(offBudget)}`, over: false })
    } else {
      summary.push({ text: `${euros(rows.reduce((sum, r) => sum + r.plannedCents, 0))} prévus`, over: false })
    }
    out.push({
      id: section.id,
      name: section.name,
      direction: section.direction,
      budgeted,
      plannedCents: rows.reduce((sum, r) => sum + r.plannedCents, 0),
      actualCents: rows.reduce((sum, r) => sum + r.actualCents, 0),
      rows,
      summary,
    })
  }
  return out
}

// Band

export interface CheckInfo {
  date: IsoDate
  gapCents: number
  /** Operations entered in the app since that check. */
  operationsSince: number
}

function checkInfo(ctx: MonthContext, check: BalanceCheck | undefined): CheckInfo | null {
  if (!check) return null
  const operationsSince = ctx.app.operations.filter((o) => o.archivedAt === null && o.createdAt > check.createdAt).length
  return { date: check.checkDate, gapCents: check.gapCents, operationsSince }
}

/** Latest balance check on or before a date, and from a date on if given. */
export function latestCheck(ctx: MonthContext, upTo: IsoDate, from?: IsoDate): CheckInfo | null {
  const candidates = ctx.app.balanceChecks
    .filter((c) => c.checkDate <= upTo && (from === undefined || c.checkDate >= from))
    .sort((a, b) => (a.checkDate < b.checkDate ? -1 : a.checkDate > b.checkDate ? 1 : a.id - b.id))
  return checkInfo(ctx, candidates[candidates.length - 1])
}

/** « Vérifié le 31/03 : identique · 2 opérations entrées depuis » (months, projection). */
export function checkText(check: CheckInfo | null, none: string): string {
  if (!check) return none
  const result = check.gapCents === 0 ? 'identique' : `écart de ${euros(check.gapCents)}`
  const since = check.operationsSince > 0 ? ` · ${count(check.operationsSince, 'opération entrée', 'opérations entrées')} depuis` : ''
  return `Vérifié le ${shortDate(check.date)} : ${result}${since}`
}

export function isUncategorized(ledger: Ledger, o: Operation): boolean {
  return ledger.partsOf(o.id).some((p) => p.categoryId === null)
}

export interface CurrentBand {
  kind: 'current'
  /** C7 today. */
  appBalanceCents: number
  check: CheckInfo | null
  /** C8 */
  projectedCents: number
  approximate: boolean
  /** Operations of the month still to categorize, and their signed total. */
  monthUncategorizedCount: number
  monthUncategorizedCents: number
  /** Positive remainders of the level-1 categories, by direction (what C8 assumes). */
  remainingOutCents: number
  remainingInCents: number
  /** Every operation still to categorize, all months (spec 3.3). */
  uncategorizedCount: number
}

export interface FutureBand {
  kind: 'future'
  /** C9 */
  projectedCents: number
  /** Planned of the month, all categories, signed. */
  plannedNetCents: number
}

export interface ClosedBand {
  kind: 'closed'
  /** C7 on the last day of the month. */
  endBalanceCents: number
  /** Balance at the start of the month plus the planned of the month. */
  plannedEndBalanceCents: number
  /** C11 */
  gapCents: number
  /** Latest check made during the month. */
  check: CheckInfo | null
  monthUncategorizedCount: number
}

export type Band = CurrentBand | FutureBand | ClosedBand

export function band(ctx: MonthContext, month: Month, kind: MonthKind, bounds: MonthBounds): Band {
  const { ledger } = ctx
  if (kind === 'future') {
    const rowOfMonth = ledger.projection(bounds.current).find((r) => r.month === month)
    return { kind, projectedCents: rowOfMonth?.endBalanceCents ?? 0, plannedNetCents: ledger.plannedNet(month) }
  }
  if (kind === 'closed') {
    const summary = ledger.monthSummary(month)
    return {
      kind,
      endBalanceCents: summary.actualEndBalanceCents,
      plannedEndBalanceCents: summary.plannedEndBalanceCents,
      gapCents: summary.gapCents,
      check: latestCheck(ctx, lastDayOfMonth(month) < ctx.today ? lastDayOfMonth(month) : ctx.today, `${month}-01`),
      monthUncategorizedCount: ledger.monthOperations(month).filter((o) => isUncategorized(ledger, o)).length,
    }
  }
  const end = ledger.currentMonthEnd(month)
  let remainingOutCents = 0
  let remainingInCents = 0
  for (const c of ledger.levelOneCategories()) {
    const r = ledger.remaining(c.id, month)
    if (r === null || r <= 0) continue
    if (ledger.sign(c.id) > 0) remainingInCents += r
    else remainingOutCents += r
  }
  const opening = ledger.data.openingBalance.balanceDate
  const uncategorizedCount = ledger.data.operations.filter(
    (o) => o.archivedAt === null && o.valueDate > opening && isUncategorized(ledger, o),
  ).length
  return {
    kind,
    appBalanceCents: ledger.balanceAt(ctx.today),
    check: latestCheck(ctx, ctx.today),
    projectedCents: end.amountCents,
    approximate: end.approximate,
    monthUncategorizedCount: end.uncategorizedCount,
    monthUncategorizedCents: end.uncategorizedCents,
    remainingOutCents,
    remainingInCents,
    uncategorizedCount,
  }
}

// Detail of a category (panel on a computer, its own screen on a phone)

export interface DetailLine {
  budgetLineId: Id
  label: string
  amountCents: number
  /** Override, or rhythm; the category it is attached to when it is another one. */
  caption: string
}

export interface DetailOperation {
  id: Id
  valueDate: IsoDate
  label: string
  manual: boolean
  /** Signed: the parts of this operation in the category (its subcategories included at level 1). */
  amountCents: number
  caption: string
}

export interface DetailView {
  id: Id
  name: string
  /** « Dépenses courantes » or « Dépenses courantes · Courses » */
  context: string
  parentId: Id | null
  row: CategoryRow
  /** Phone: the subcategories, as on the computer's table. */
  children: CategoryRow[]
  lines: DetailLine[]
  /** When there is no line this month. */
  noLines: string
  /** Null for a future month: the planned only. */
  operations: DetailOperation[] | null
}

function monthsList(months: number[]): string {
  const sorted = [...months].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const m of sorted) {
    const last = runs[runs.length - 1]
    if (last && m === last[1] + 1) last[1] = m
    else runs.push([m, m])
  }
  return runs
    .map(([a, b]) => (a === b ? MONTH_NAMES[a - 1] : `${MONTH_NAMES[a - 1]} à ${MONTH_NAMES[b - 1]}`))
    .join(', ')
}

export function rhythmText(rhythm: Rhythm): string {
  if (rhythm.kind === 'months') return `Mois cochés : ${monthsList(rhythm.months)}`
  return rhythm.everyN === 1 ? 'Tous les mois' : `Tous les ${rhythm.everyN} mois`
}

export function path(ledger: Ledger, id: Id): string {
  const c = ledger.category(id)
  return c.parentId === null ? c.name : `${ledger.category(c.parentId).name} > ${c.name}`
}

export function detail(ctx: MonthContext, month: Month, kind: MonthKind, id: Id): DetailView | null {
  const { ledger, app } = ctx
  let c: Category
  try {
    c = ledger.category(id)
  } catch {
    return null
  }
  const all = sections(ctx, month, kind)
  const top = all.flatMap((s) => s.rows).find((r) => r.id === (c.parentId ?? c.id))
  const found = c.parentId === null ? top : top?.children.find((r) => r.id === id && !r.withoutDetail)
  if (!found) return null
  const section = ledger.sectionOf(id)
  const name = monthName(month)

  const lines: DetailLine[] = ledger
    .appliedLines(month)
    .filter((l) => l.categoryId === id || (c.parentId === null && ledger.root(l.categoryId).id === id))
    .sort((a, b) => ledger.category(a.categoryId).sortOrder - ledger.category(b.categoryId).sortOrder || a.budgetLineId - b.budgetLineId)
    .map((l) => {
      const label = app.budgetLines.find((b) => b.id === l.budgetLineId)?.label ?? ''
      let caption = rhythmText(l.version.rhythm)
      if (l.override) {
        const stored = app.overrides.find((o) => o.id === l.override?.id)
        const verb = l.override.amountCents === 0 ? 'Annulée' : 'Surchargée'
        caption = `${verb} en ${name}, au lieu de ${euros(l.version.amountCents)}`
        if (l.override.reason) caption += ` ; motif : ${l.override.reason}`
        if (stored) caption += ` ; par ${stored.createdBy}`
      }
      if (l.categoryId !== id) caption = `${path(ledger, l.categoryId)} · ${caption}`
      return { budgetLineId: l.budgetLineId, label, amountCents: l.amountCents, caption }
    })

  let noLines = 'Aucune ligne de budget ce mois-ci.'
  if (found.status === 'within' && c.parentId !== null) noLines = `Comptée dans ${ledger.category(c.parentId).name}.`

  let operations: DetailOperation[] | null = null
  if (kind !== 'future') {
    operations = []
    const ops = [...ledger.monthOperations(month)].sort((a, b) =>
      a.valueDate > b.valueDate ? -1 : a.valueDate < b.valueDate ? 1 : b.id - a.id,
    )
    for (const o of ops) {
      const parts = ledger.partsOf(o.id)
      const mine = parts.filter(
        (p) => p.categoryId !== null && (p.categoryId === id || (c.parentId === null && ledger.root(p.categoryId).id === id)),
      )
      if (mine.length === 0) continue
      const captions: string[] = []
      if (parts.length > 1) {
        const pieces = parts.map((p) => `${euros(p.amountCents)} ${p.categoryId === null ? 'à catégoriser' : ledger.category(p.categoryId).name}`)
        captions.push(`Répartie : ${pieces.join(', ')}`)
      } else {
        const only = mine[0]?.categoryId as Id
        if (only !== id) captions.push(ledger.category(only).name)
        else if (c.parentId === null && ledger.children(id).length > 0) captions.push('Sans détail')
      }
      if (o.comment) captions.push(o.comment)
      operations.push({
        id: o.id,
        valueDate: o.valueDate,
        label: o.bankLabel ?? 'Ajout manuel',
        manual: o.origin === 'manual',
        amountCents: mine.reduce((sum, p) => sum + p.amountCents, 0),
        caption: captions.join(' · '),
      })
    }
  }

  const parent = c.parentId === null ? null : ledger.category(c.parentId)
  return {
    id,
    name: c.name,
    context: parent ? `${section.name} · ${parent.name}` : section.name,
    parentId: c.parentId,
    row: found,
    children: c.parentId === null ? found.children.filter((r) => !r.withoutDetail) : [],
    lines,
    noLines,
    operations,
  }
}
