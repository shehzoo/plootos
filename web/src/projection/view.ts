// What the projection screen shows (spec 3.5): the planned end-of-month balance from the current
// month to December of year N+3 (C8, then C9), as figures, a curve and a table by year. Pure
// functions, tested on the example month (spec 1.3, 1.4); the component only lays them out.

import { type Month, type ProjectionRow } from '../../../shared/src/engine'
import { count, signedEuros } from '../format'
import { band, latestCheck, monthBounds, type CheckInfo, type MonthContext } from '../month/view'

export interface YearView {
  year: string
  rows: ProjectionRow[]
  /** Balance at the end of the year: what a folded year shows. */
  endBalanceCents: number
}

export interface Approximate {
  /** Operations of the current month still to categorize. */
  count: number
  outCents: number
  inCents: number
}

export interface ProjectionView {
  current: Month
  /** C7 today, the starting point of the projection. */
  appBalanceCents: number
  check: CheckInfo | null
  /** First month whose end balance is below zero. */
  belowZero: Month | null
  /** Lowest end balance, and its month. */
  low: { month: Month; cents: number }
  rows: ProjectionRow[]
  years: YearView[]
  approximate: Approximate | null
}

export function projectionView(ctx: MonthContext): ProjectionView {
  const { ledger, today } = ctx
  const bounds = monthBounds(ctx)
  const rows = ledger.projection(bounds.current)
  let low = rows[0] as ProjectionRow
  for (const r of rows) if (r.endBalanceCents < low.endBalanceCents) low = r
  const below = rows.find((r) => r.endBalanceCents < 0)

  const years: YearView[] = []
  for (const r of rows) {
    const year = r.month.slice(0, 4)
    let y = years[years.length - 1]
    if (!y || y.year !== year) {
      y = { year, rows: [], endBalanceCents: 0 }
      years.push(y)
    }
    y.rows.push(r)
    y.endBalanceCents = r.endBalanceCents
  }

  const current = band(ctx, bounds.current, 'current', bounds)
  let approximate: Approximate | null = null
  if (current.kind === 'current' && current.approximate) {
    approximate = { count: current.monthUncategorizedCount, outCents: 0, inCents: 0 }
    for (const o of ledger.monthOperations(bounds.current)) {
      for (const p of ledger.partsOf(o.id)) {
        if (p.categoryId !== null) continue
        if (p.amountCents < 0) approximate.outCents += -p.amountCents
        else approximate.inCents += p.amountCents
      }
    }
  }

  return {
    current: bounds.current,
    appBalanceCents: ledger.balanceAt(today),
    check: latestCheck(ctx, today),
    belowZero: below ? below.month : null,
    low: { month: low.month, cents: low.endBalanceCents },
    rows,
    years,
    approximate,
  }
}

/** « Approximatif : 2 opérations à catégoriser (−35 €, +20 €). » */
export function approximateText(a: Approximate): string {
  const parts = [a.outCents > 0 ? signedEuros(-a.outCents) : '', a.inCents > 0 ? signedEuros(a.inCents) : ''].filter(Boolean)
  return `Approximatif : ${count(a.count, 'opération')} à catégoriser (${parts.join(', ')}) dans le mois en cours.`
}

// The curve

export interface ChartTick {
  cents: number
  y: number
}

export interface ChartYearMark {
  year: string
  x: number
}

export interface ChartGeometry {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
  /** « 2027-03 » … in order, with their point. */
  points: { month: Month; cents: number; x: number; y: number }[]
  ticks: ChartTick[]
  /** Y of the 0 € line, only when the curve goes under zero. */
  zeroY: number | null
  /** Y of 0 €, bottom of the filled area (the axis always holds 0 €). */
  baseY: number
  years: ChartYearMark[]
  low: { x: number; y: number }
}

/** A round step (1, 2, 5 times a power of ten) that gives about `target` steps over `span`. */
function niceStep(span: number, target: number): number {
  const rough = Math.max(span, 1) / target
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const f = rough / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
}

/**
 * Plot of the end balances (spec 3.5): a computer's curve is wide and low, with more marks; a
 * phone's is taller and has few (« une courbe propre au téléphone »). The axis always holds 0 €
 * so that "under zero" reads at a glance; the 0 € line is drawn when the curve goes under it.
 */
export function chartGeometry(rows: ProjectionRow[], narrow: boolean): ChartGeometry {
  const width = narrow ? 350 : 980
  const height = narrow ? 260 : 240
  const left = narrow ? 74 : 76
  const right = 12
  const top = 14
  const bottom = 26
  const values = rows.map((r) => r.endBalanceCents)
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const step = niceStep(max - min, narrow ? 3 : 5)
  const axisTop = Math.ceil(max / step) * step
  const axisBottom = Math.floor(min / step) * step
  const span = axisTop - axisBottom || step
  const x = (i: number) => left + (rows.length <= 1 ? 0 : (i * (width - left - right)) / (rows.length - 1))
  const y = (v: number) => top + ((axisTop - v) * (height - top - bottom)) / span
  const ticks: ChartTick[] = []
  for (let v = axisBottom; v <= axisTop + 1e-6; v += step) ticks.push({ cents: v, y: y(v) })
  const points = rows.map((r, i) => ({ month: r.month, cents: r.endBalanceCents, x: x(i), y: y(r.endBalanceCents) }))
  const years: ChartYearMark[] = []
  points.forEach((p, i) => {
    if (i === 0 || p.month.endsWith('-01')) years.push({ year: p.month.slice(0, 4), x: p.x })
  })
  let lowIndex = 0
  values.forEach((v, i) => {
    if (v < (values[lowIndex] as number)) lowIndex = i
  })
  const lowPoint = points[lowIndex] as { x: number; y: number }
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    points,
    ticks,
    zeroY: min < 0 ? y(0) : null,
    baseY: y(0),
    years,
    low: { x: lowPoint.x, y: lowPoint.y },
  }
}
