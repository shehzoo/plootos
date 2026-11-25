// Calculations C1 to C11 (spec 2.3) and the category suggestion R11 (spec 2.2), as pure
// reads of the data: the browser and the Worker run this same code (spec 4.1).
//
// Sign convention: planned and actual amounts are signed like operations, + in, - out.
// s = +1 for an income category, -1 for an expense category.

import { addMonths, lastDayOfMonth, monthOf } from './dates'
import { suggestionKey } from './labels'
import type {
  BudgetData,
  BudgetLineVersion,
  BudgetOverride,
  Category,
  Id,
  IsoDate,
  Month,
  OpeningBalance,
  Operation,
  Section,
} from './model'
import { rhythmFallsOn, versionCovers } from './rhythm'

/** A budget line that applies in a month (C1), with its amount that month (C2). */
export interface AppliedLine {
  budgetLineId: Id
  version: BudgetLineVersion
  override: BudgetOverride | null
  categoryId: Id
  /** Unsigned, as stored. */
  amountCents: number
  /** Signed by the section's direction. */
  signedCents: number
}

/**
 * How a category reads in a month (spec, Vocabulaire):
 * - budgeted: it has an applicable line (at level 1, its subcategories' lines count): it has a remainder;
 * - within: subcategory without its own line, whose level-1 category is budgeted ("Dans Courses");
 * - off_budget: no applicable line in its level-1 category, yet operations this month;
 * - none: neither lines nor operations.
 */
export type BudgetStatus = 'budgeted' | 'within' | 'off_budget' | 'none'

export interface CurrentMonthProjection {
  /** C8: app balance on the last day of the month, plus the positive remainders. */
  amountCents: number
  /** True while the month holds operations to categorize: the figure is then approximate. */
  approximate: boolean
  uncategorizedCount: number
  /** Signed sum of the parts still to categorize. */
  uncategorizedCents: number
}

export interface ProjectionRow {
  month: Month
  /** Planned for the month, all categories (signed). */
  plannedCents: number
  /** Projected balance at the end of the month (C8 for the current month, C9 after). */
  endBalanceCents: number
}

export interface SectionRemaining {
  /** C10: sum of the positive remainders of its budgeted level-1 categories. */
  remainingCents: number
  /** Expense sections: one per overrun category, else one per overrun subcategory. */
  overrunCount: number
  /** Total of those overruns, positive. */
  overrunCents: number
  /** Income sections: received beyond the plan, positive. */
  extraReceivedCents: number
  /** Signed actual of its off-budget level-1 categories, shown apart. */
  offBudgetActualCents: number
}

export interface MonthSummary {
  plannedNetCents: number
  /** Categorized parts only (the actual). */
  actualNetCents: number
  /** C11: actual minus planned, all categories; positive is better than planned. */
  gapCents: number
  startBalanceCents: number
  /** Balance at the start of the month plus the planned of the month. */
  plannedEndBalanceCents: number
  /** C7 on the last day of the month. */
  actualEndBalanceCents: number
}

interface MonthFigures {
  applied: AppliedLine[]
  planned: Map<Id, number>
  actual: Map<Id, number>
  /** Applicable lines attached to the category itself. */
  ownLines: Map<Id, number>
  /** Applicable lines of the level-1 category, its subcategories included. */
  rolledLines: Map<Id, number>
  /** Categorized parts, rolled up to level 1 too. */
  partCount: Map<Id, number>
  plannedNet: number
  actualNet: number
  uncategorizedCount: number
  uncategorizedCents: number
}

const add = (map: Map<Id, number>, key: Id, value: number) => map.set(key, (map.get(key) ?? 0) + value)
/** Never -0: a sign applied to zero must not show as "-0 €". */
const signed = (sign: 1 | -1, value: number) => (value === 0 ? 0 : sign * value)

/**
 * C7, the rule itself: the opening balance plus the active operations valued after it, up to
 * this date included. The Worker uses it to record a balance check (spec 4.1), on totals by
 * value date; the Ledger answers the same, faster, from running totals.
 */
export function balanceOf(opening: OpeningBalance, entries: Iterable<{ valueDate: IsoDate; amountCents: number }>, date: IsoDate): number {
  let total = opening.amountCents
  for (const e of entries) if (e.valueDate > opening.balanceDate && e.valueDate <= date) total += e.amountCents
  return total
}

export class Ledger {
  private readonly categoryById = new Map<Id, Category>()
  private readonly sectionById = new Map<Id, Section>()
  private readonly childrenById = new Map<Id, Category[]>()
  private readonly versionsByLine = new Map<Id, BudgetLineVersion[]>()
  private readonly overrideByLineMonth = new Map<string, BudgetOverride>()
  private readonly opsByMonth = new Map<Month, Operation[]>()
  private readonly partsByOperation = new Map<Id, BudgetData['parts']>()
  /** Active operations after the opening balance, by value date, with running totals (C7). */
  private readonly balanceDates: IsoDate[] = []
  private readonly balanceTotals: number[] = []
  private readonly monthCache = new Map<Month, MonthFigures>()
  private suggestionIndex: Map<string, { operation: Operation; categoryId: Id }> | null = null

  constructor(readonly data: BudgetData) {
    for (const s of data.sections) this.sectionById.set(s.id, s)
    for (const c of data.categories) {
      this.categoryById.set(c.id, c)
      if (c.parentId !== null) {
        const list = this.childrenById.get(c.parentId) ?? []
        list.push(c)
        this.childrenById.set(c.parentId, list)
      }
    }
    for (const v of data.versions) {
      if (v.replacedAt !== null) continue
      const list = this.versionsByLine.get(v.budgetLineId) ?? []
      list.push(v)
      this.versionsByLine.set(v.budgetLineId, list)
    }
    for (const list of this.versionsByLine.values()) list.sort((a, b) => (a.startMonth < b.startMonth ? -1 : 1))
    for (const o of data.overrides) {
      if (o.removedAt === null) this.overrideByLineMonth.set(`${o.budgetLineId}|${o.month}`, o)
    }
    for (const p of data.parts) {
      const list = this.partsByOperation.get(p.operationId) ?? []
      list.push(p)
      this.partsByOperation.set(p.operationId, list)
    }
    const opening = data.openingBalance
    const active = data.operations
      .filter((o) => o.archivedAt === null && o.valueDate > opening.balanceDate)
      .sort((a, b) => (a.valueDate < b.valueDate ? -1 : a.valueDate > b.valueDate ? 1 : 0))
    let total = opening.amountCents
    for (const o of active) {
      total += o.amountCents
      this.balanceDates.push(o.valueDate)
      this.balanceTotals.push(total)
      const month = monthOf(o.valueDate)
      const list = this.opsByMonth.get(month) ?? []
      list.push(o)
      this.opsByMonth.set(month, list)
    }
  }

  // Categories

  category(id: Id): Category {
    const c = this.categoryById.get(id)
    if (!c) throw new Error(`Unknown category ${id}`)
    return c
  }

  /** The level-1 category of a category (itself at level 1). */
  root(id: Id): Category {
    const c = this.category(id)
    return c.parentId === null ? c : this.category(c.parentId)
  }

  sectionOf(id: Id): Section {
    const sectionId = this.root(id).sectionId
    const s = sectionId === null ? undefined : this.sectionById.get(sectionId)
    if (!s) throw new Error(`Category ${id} has no section`)
    return s
  }

  /** s: +1 for an income category, -1 for an expense category. */
  sign(id: Id): 1 | -1 {
    return this.sectionOf(id).direction === 'in' ? 1 : -1
  }

  children(id: Id): Category[] {
    return this.childrenById.get(id) ?? []
  }

  levelOneCategories(sectionId?: Id): Category[] {
    return this.data.categories.filter(
      (c) => c.parentId === null && (sectionId === undefined || c.sectionId === sectionId),
    )
  }

  /** A part can be put in this category now (R2, R4, R10). */
  isChoosable(id: Id): boolean {
    const c = this.categoryById.get(id)
    if (!c || c.archivedAt !== null) return false
    const root = this.root(id)
    if (root.archivedAt !== null) return false
    if (this.sectionOf(id).archivedAt !== null) return false
    return !this.children(id).some((child) => child.archivedAt === null)
  }

  // C1, C2

  /** The budget line in a month: its version and amount, or null when it does not apply (C1, C2). */
  lineInMonth(budgetLineId: Id, month: Month): AppliedLine | null {
    const version = (this.versionsByLine.get(budgetLineId) ?? []).find((v) => versionCovers(v, month))
    if (!version || !rhythmFallsOn(version.rhythm, month)) return null
    const override = this.overrideByLineMonth.get(`${budgetLineId}|${month}`) ?? null
    const amountCents = override ? override.amountCents : version.amountCents
    return {
      budgetLineId,
      version,
      override,
      categoryId: version.categoryId,
      amountCents,
      signedCents: signed(this.sign(version.categoryId), amountCents),
    }
  }

  appliedLines(month: Month): AppliedLine[] {
    return this.figures(month).applied
  }

  // C3, C4, C5, C6

  /** C3: signed planned of a category (at level 1, its subcategories included). */
  planned(categoryId: Id, month: Month): number {
    return this.figures(month).planned.get(categoryId) ?? 0
  }

  /** C4: signed sum of its categorized parts (at level 1, its subcategories included). */
  actual(categoryId: Id, month: Month): number {
    return this.figures(month).actual.get(categoryId) ?? 0
  }

  status(categoryId: Id, month: Month): BudgetStatus {
    const f = this.figures(month)
    const c = this.category(categoryId)
    const ownOrRolled = c.parentId === null ? f.rolledLines : f.ownLines
    if ((ownOrRolled.get(categoryId) ?? 0) > 0) return 'budgeted'
    if (c.parentId !== null && (f.rolledLines.get(c.parentId) ?? 0) > 0) return 'within'
    return (f.partCount.get(categoryId) ?? 0) > 0 ? 'off_budget' : 'none'
  }

  /** C5: s x (planned - actual), only for a category with an applicable line; negative is an overrun. */
  remaining(categoryId: Id, month: Month): number | null {
    if (this.status(categoryId, month) !== 'budgeted') return null
    return signed(this.sign(categoryId), this.planned(categoryId, month) - this.actual(categoryId, month))
  }

  /** C6: s x (actual - planned); positive means more than planned. */
  gap(categoryId: Id, month: Month): number {
    return signed(this.sign(categoryId), this.actual(categoryId, month) - this.planned(categoryId, month))
  }

  // C7, C8, C9

  /** C7: opening balance plus the active operations valued after it, up to this date included. */
  balanceAt(date: IsoDate): number {
    let lo = 0
    let hi = this.balanceDates.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((this.balanceDates[mid] as IsoDate) <= date) lo = mid + 1
      else hi = mid
    }
    return lo === 0 ? this.data.openingBalance.amountCents : (this.balanceTotals[lo - 1] as number)
  }

  /** C8: projected balance at the end of the current month. */
  currentMonthEnd(currentMonth: Month): CurrentMonthProjection {
    const f = this.figures(currentMonth)
    let amount = this.balanceAt(lastDayOfMonth(currentMonth))
    for (const c of this.levelOneCategories()) {
      const r = this.remaining(c.id, currentMonth)
      // An overrun is already in the balance: only positive remainders are added, signed.
      if (r !== null && r > 0) amount += this.sign(c.id) * r
    }
    return {
      amountCents: amount,
      approximate: f.uncategorizedCount > 0,
      uncategorizedCount: f.uncategorizedCount,
      uncategorizedCents: f.uncategorizedCents,
    }
  }

  /** Planned of the month, all categories (signed). */
  plannedNet(month: Month): number {
    return this.figures(month).plannedNet
  }

  /** C9: from the current month to December of year N+3. */
  projection(currentMonth: Month): ProjectionRow[] {
    const last = `${Number(currentMonth.slice(0, 4)) + 3}-12`
    const rows: ProjectionRow[] = []
    let balance = this.currentMonthEnd(currentMonth).amountCents
    rows.push({ month: currentMonth, plannedCents: this.plannedNet(currentMonth), endBalanceCents: balance })
    for (let m = addMonths(currentMonth, 1); m <= last; m = addMonths(m, 1)) {
      const planned = this.plannedNet(m)
      balance += planned
      rows.push({ month: m, plannedCents: planned, endBalanceCents: balance })
    }
    return rows
  }

  // C10, C11

  /** C10: remainder of a section in the current month, with its overruns beside it. */
  sectionRemaining(sectionId: Id, month: Month): SectionRemaining {
    const result: SectionRemaining = {
      remainingCents: 0,
      overrunCount: 0,
      overrunCents: 0,
      extraReceivedCents: 0,
      offBudgetActualCents: 0,
    }
    const section = this.sectionById.get(sectionId)
    if (!section) throw new Error(`Unknown section ${sectionId}`)
    for (const c of this.levelOneCategories(sectionId)) {
      const status = this.status(c.id, month)
      if (status === 'off_budget') {
        result.offBudgetActualCents += this.actual(c.id, month)
        continue
      }
      if (status !== 'budgeted') continue
      const r = this.remaining(c.id, month) as number
      if (r > 0) result.remainingCents += r
      if (section.direction === 'in') {
        if (r < 0) result.extraReceivedCents -= r
        continue
      }
      if (r < 0) {
        result.overrunCount += 1
        result.overrunCents -= r
        continue
      }
      for (const sub of this.children(c.id)) {
        const rs = this.remaining(sub.id, month)
        if (rs !== null && rs < 0) {
          result.overrunCount += 1
          result.overrunCents -= rs
        }
      }
    }
    return result
  }

  /** C11: gap of a section in a closed month, sum of the gaps of its level-1 categories. */
  sectionGap(sectionId: Id, month: Month): number {
    return this.levelOneCategories(sectionId).reduce((sum, c) => sum + this.gap(c.id, month), 0)
  }

  /** Totals of a month: planned, actual, gap (C11) and balances (U6). */
  monthSummary(month: Month): MonthSummary {
    const f = this.figures(month)
    const start = this.balanceAt(lastDayOfMonth(addMonths(month, -1)))
    return {
      plannedNetCents: f.plannedNet,
      actualNetCents: f.actualNet,
      gapCents: f.actualNet - f.plannedNet,
      startBalanceCents: start,
      plannedEndBalanceCents: start + f.plannedNet,
      actualEndBalanceCents: this.balanceAt(lastDayOfMonth(month)),
    }
  }

  // Operations of a month (detail of a category, screens 3.1 and 3.4)

  /** Active operations valued in the month, by value date. */
  monthOperations(month: Month): Operation[] {
    return this.opsByMonth.get(month) ?? []
  }

  /** Parts of an operation: one by default, several when it is split. */
  partsOf(operationId: Id): BudgetData['parts'] {
    return this.partsByOperation.get(operationId) ?? []
  }

  // R11

  /**
   * R11: category of the latest operation with the same bank label (compared by its
   * suggestion key), not split; null when there is none or when that category can no longer
   * be chosen.
   */
  suggestCategory(bankLabel: string | null): Id | null {
    if (!bankLabel) return null
    const hit = this.suggestions().get(suggestionKey(bankLabel))
    if (!hit) return null
    return this.isChoosable(hit.categoryId) ? hit.categoryId : null
  }

  private suggestions(): Map<string, { operation: Operation; categoryId: Id }> {
    if (this.suggestionIndex) return this.suggestionIndex
    const index = new Map<string, { operation: Operation; categoryId: Id }>()
    for (const o of this.data.operations) {
      if (o.archivedAt !== null || !o.bankLabel) continue
      const parts = this.partsByOperation.get(o.id) ?? []
      // A split operation is never a model.
      if (parts.length !== 1) continue
      const categoryId = (parts[0] as BudgetData['parts'][number]).categoryId
      if (categoryId === null) continue
      const key = suggestionKey(o.bankLabel)
      const current = index.get(key)
      if (!current || isLater(o, current.operation)) index.set(key, { operation: o, categoryId })
    }
    this.suggestionIndex = index
    return index
  }

  // Figures of one month, computed once for all categories.

  private figures(month: Month): MonthFigures {
    const cached = this.monthCache.get(month)
    if (cached) return cached
    const f: MonthFigures = {
      applied: [],
      planned: new Map(),
      actual: new Map(),
      ownLines: new Map(),
      rolledLines: new Map(),
      partCount: new Map(),
      plannedNet: 0,
      actualNet: 0,
      uncategorizedCount: 0,
      uncategorizedCents: 0,
    }
    for (const line of this.data.budgetLines) {
      const applied = this.lineInMonth(line.id, month)
      if (!applied) continue
      f.applied.push(applied)
      f.plannedNet += applied.signedCents
      const c = this.category(applied.categoryId)
      add(f.planned, c.id, applied.signedCents)
      add(f.ownLines, c.id, 1)
      add(f.rolledLines, c.id, 1)
      if (c.parentId !== null) {
        add(f.planned, c.parentId, applied.signedCents)
        add(f.rolledLines, c.parentId, 1)
      }
    }
    for (const o of this.opsByMonth.get(month) ?? []) {
      let uncategorized = false
      for (const p of this.partsByOperation.get(o.id) ?? []) {
        if (p.categoryId === null) {
          uncategorized = true
          f.uncategorizedCents += p.amountCents
          continue
        }
        f.actualNet += p.amountCents
        const c = this.category(p.categoryId)
        add(f.actual, c.id, p.amountCents)
        add(f.partCount, c.id, 1)
        if (c.parentId !== null) {
          add(f.actual, c.parentId, p.amountCents)
          add(f.partCount, c.parentId, 1)
        }
      }
      if (uncategorized) f.uncategorizedCount += 1
    }
    this.monthCache.set(month, f)
    return f
  }
}

function isLater(a: Operation, b: Operation): boolean {
  if (a.valueDate !== b.valueDate) return a.valueDate > b.valueDate
  if (a.opDate !== b.opDate) return a.opDate > b.opDate
  return a.id > b.id
}
