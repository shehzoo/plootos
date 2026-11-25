// Screen 3.5, projection of the balance, on a computer and on a phone, read only (lot 6).
// The curve is drawn here in SVG with the design system's variables (the design system has no
// chart component yet: DECISIONS.md, 2026-11-25).

import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import { type Month } from '../../../shared/src/engine'
import { eurosOrMinus, monthTitle, shortDate, signedEuros } from '../format'
import { Icon } from '../icons'
import { checkText, type MonthContext } from '../month/view'
import { monthPath, navigate } from '../router'
import { approximateText, chartGeometry, projectionView, type ProjectionView } from './view'

function Tile({ label, value, sub, narrow }: { label: string; value: string; sub?: string; narrow: boolean }) {
  return (
    <div class="pl-stat">
      <span class="pl-stat__k label">{label}</span>
      <span class={`pl-stat__v ${narrow ? 'amount-l' : 'amount-xl'}`}>{value}</span>
      {sub && <span class="pl-stat__s caption">{sub}</span>}
    </div>
  )
}

function Curve({ view, narrow }: { view: ProjectionView; narrow: boolean }) {
  const g = chartGeometry(view.rows, narrow)
  const line = g.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const first = g.points[0]
  const last = g.points[g.points.length - 1]
  if (!first || !last) return null
  const area = `${first.x.toFixed(1)},${g.baseY.toFixed(1)} ${line} ${last.x.toFixed(1)},${g.baseY.toFixed(1)}`
  const lastYear = view.rows[view.rows.length - 1]?.month.slice(0, 4)
  return (
    <svg
      class="chart"
      viewBox={`0 0 ${g.width} ${g.height}`}
      role="img"
      aria-label={`Solde prévu en fin de mois, de ${monthTitle(view.current)} à décembre ${lastYear}`}
    >
      {g.ticks.map((t) => (
        <Fragment key={t.cents}>
          <line class="chart__grid" x1={g.left} x2={g.width - g.right} y1={t.y} y2={t.y} />
          <text class="chart__text caption" x={g.left - 8} y={t.y + 4} text-anchor="end">
            {eurosOrMinus(t.cents)}
          </text>
        </Fragment>
      ))}
      {g.zeroY !== null && <line class="chart__zero" x1={g.left} x2={g.width - g.right} y1={g.zeroY} y2={g.zeroY} />}
      {g.years.map((y, i) => (
        <Fragment key={y.year}>
          <line class="chart__grid" x1={y.x} x2={y.x} y1={g.height - g.bottom} y2={g.height - g.bottom + 4} />
          <text class="chart__text caption" x={y.x} y={g.height - 6} text-anchor={i === 0 ? 'start' : 'middle'}>
            {y.year}
          </text>
        </Fragment>
      ))}
      <polygon class="chart__area" points={area} />
      <polyline class="chart__line" points={line} />
      <circle class="chart__low" cx={g.low.x} cy={g.low.y} r={4} />
    </svg>
  )
}

function YearTable({ view, today }: { view: ProjectionView; today: Month }) {
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const toggle = (year: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  const open = (month: Month) => navigate(monthPath(month === today ? null : month))
  return (
    <div class="pl-table projection-table">
      <div class="pl-row pl-row--head label">
        <span>Mois</span>
        <span class="pl-num">Prévu du mois</span>
        <span class="pl-num">Solde prévu en fin de mois</span>
      </div>
      {view.years.map((y) => {
        const isOpen = !folded.has(y.year)
        return (
          <div key={y.year}>
            <div class="pl-row pl-row--section">
              <button type="button" class="pl-row__toggle title-s" aria-expanded={isOpen} onClick={() => toggle(y.year)}>
                <Icon name="chevron-bas" />
                {y.year}
              </button>
              <span />
              <span class="pl-num title-s">{isOpen ? '' : eurosOrMinus(y.endBalanceCents)}</span>
            </div>
            {isOpen &&
              y.rows.map((r) => (
                <button type="button" key={r.month} class="pl-row table month-row projection-row" onClick={() => open(r.month)}>
                  <span>
                    {monthTitle(r.month)}
                    {r.month === today && <span class="caption pl-muted"> · en cours</span>}
                  </span>
                  <span class="pl-num">{signedEuros(r.plannedCents)}</span>
                  <span class="pl-num">{eurosOrMinus(r.endBalanceCents)}</span>
                </button>
              ))}
          </div>
        )
      })}
    </div>
  )
}

export function ProjectionScreen({ ctx, narrow }: { ctx: MonthContext; narrow: boolean }) {
  const view = projectionView(ctx)
  const lowText = eurosOrMinus(view.low.cents)
  const lastYear = view.rows[view.rows.length - 1]?.month.slice(0, 4)
  const second = view.belowZero
    ? { label: 'Sous zéro dès', value: monthTitle(view.belowZero), sub: `Point bas ${lowText}, ${monthTitle(view.low.month)}` }
    : { label: 'Point bas', value: lowText, sub: monthTitle(view.low.month) }
  return (
    <div class="projection">
      {!narrow && (
        <header class="projection__head">
          <h1 class="title-l">Projection</h1>
          <span class="caption pl-muted">Solde prévu en fin de mois, jusqu'à décembre {lastYear}</span>
        </header>
      )}
      <section class={`pl-band${narrow ? ' pl-band--phone' : ''}`} aria-label="Projection du solde">
        {narrow && (
          <div class="pl-band__top">
            <div class="month-title">
              <h1 class="title-m">Projection</h1>
              <span class="caption month-title__kind">Jusqu'à décembre {lastYear}</span>
            </div>
          </div>
        )}
        <div class={`pl-stats${narrow ? '' : ' stats-2'}`}>
          <Tile
            label={`Solde de l'appli au ${shortDate(ctx.today)}`}
            value={eurosOrMinus(view.appBalanceCents)}
            sub={checkText(view.check, 'Jamais vérifié')}
            narrow={narrow}
          />
          <Tile label={second.label} value={second.value} sub={second.sub} narrow={narrow} />
        </div>
      </section>
      {view.approximate && (
        <div class="pl-banner body month-banner" role="status">
          <span>{approximateText(view.approximate)}</span>
        </div>
      )}
      <div class="pl-panel projection__chart">
        <Curve view={view} narrow={narrow} />
      </div>
      <YearTable view={view} today={view.current} />
    </div>
  )
}
