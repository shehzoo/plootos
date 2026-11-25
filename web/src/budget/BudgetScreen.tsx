// Screen 3.6, budget lines: a year grid on a computer, one month on a phone, and the record of
// a line (its versions and overrides). On a computer (lot 8): « + Nouvelle ligne », a click on
// the cell of a current or later month overrides it, a click on a line's name opens its panel
// (change, archive). A phone only reads (spec 3.0).

import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import { addMonths, type Id, type Month } from '../../../shared/src/engine'
import { useFoldedSections } from '../display'
import { euros, fullDate, monthTitle, plainEuros, signedEuros, signedPlainEuros } from '../format'
import { Icon } from '../icons'
import type { MonthContext } from '../month/view'
import { back, budgetPath, navigate, newLinePath, type Place } from '../router'
import { LinePanel, NewLinePanel, OverrideDialog } from './LineEditor'
import { overrideTarget } from './lines'
import {
  budgetBounds,
  budgetView,
  clampBudgetMonth,
  lineRecord,
  SHORT_MONTHS,
  yearMonths,
  type BudgetBounds,
  type BudgetSectionView,
  type LineRecord,
  type LineRow,
} from './view'

/** The current month has no month in its path. */
const pathOf = (month: Month, bounds: BudgetBounds, lineId: Id | null = null) =>
  budgetPath(month === bounds.current ? null : month, lineId)

const upcomingText = (n: number) => (n === 1 ? '1 surcharge à venir' : `${n} surcharges à venir`)

/** Record of a line: what it is now, then its versions and overrides, with author and date. */
function Record({ record }: { record: LineRecord }) {
  return (
    <>
      <div class="pl-kv budget-kv">
        <div>
          <span class="label">Montant</span>
          <b class="amount-m">{euros(record.amountCents)}</b>
        </div>
        <div>
          <span class="label">Rythme</span>
          <b class="amount-m budget-kv__wrap">{record.rhythm}</b>
        </div>
      </div>
      <p class="caption pl-muted detail-note">
        {record.categoryPath} · {record.period}
        {record.archived ? ' · archivée' : ''}
      </p>
      <div class="pl-group">
        <h3 class="title-s">Versions</h3>
        {record.versions.map((v) => (
          <div key={v.id} class="pl-op table">
            <span>
              {euros(v.amountCents)} · {v.rhythm}
              <small class="caption">
                {v.period}
                {v.replaced ? ' · remplacée' : ''} · {v.categoryPath}
              </small>
              <small class="caption">
                par {v.by}
                {v.on ? ` le ${fullDate(v.on)}` : ''}
              </small>
            </span>
          </div>
        ))}
      </div>
      <div class="pl-group">
        <h3 class="title-s">Surcharges</h3>
        {record.overrides.length === 0 && <p class="caption pl-muted detail-note">Aucune surcharge.</p>}
        {record.overrides.map((o) => (
          <div key={o.id} class="pl-op table">
            <span>
              {monthTitle(o.month)}
              <small class="caption">
                {o.removed ? 'retirée' : o.amountCents === 0 ? 'ligne annulée ce mois' : 'surcharge'}
                {o.reason ? ` · motif : ${o.reason}` : ''}
              </small>
              <small class="caption">
                par {o.by}
                {o.on ? ` le ${fullDate(o.on)}` : ''}
                {o.removed ? ` · retirée par ${o.removedBy} le ${fullDate(o.removedOn)}` : ''}
              </small>
            </span>
            <span class={`pl-num${o.removed ? ' pl-muted' : ''}`}>{euros(o.amountCents)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// Computer: the year grid

function YearGrid(props: {
  sections: BudgetSectionView[]
  months: Month[]
  net: (number | null)[]
  current: Month
  selected: Id | null
  folded: Set<number>
  toggle: (id: number) => void
  open: (id: Id) => void
  /** Null on a phone; else opens the override of a line's month (current or later, where it applies). */
  override: ((lineId: Id, month: Month) => void) | null
}) {
  const { months, current, selected, folded, toggle } = props
  const past = (m: Month) => (m < current ? ' budget-past' : '')
  return (
    <div class="budget-scroll">
      <div class="pl-table budget-grid">
        <div class="pl-row pl-row--head label">
          <span>Ligne</span>
          {months.map((m, i) => (
            <span key={m} class={`pl-num${past(m)}`}>
              {SHORT_MONTHS[i]}
            </span>
          ))}
        </div>
        {props.sections.map((s) => {
          const isOpen = !folded.has(s.id)
          return (
            <Fragment key={s.id}>
              <div class="pl-row pl-row--section">
                <button type="button" class="pl-row__toggle title-s" aria-expanded={isOpen} onClick={() => toggle(s.id)}>
                  <Icon name="chevron-bas" />
                  {s.name}
                </button>
                {s.totals.map((t, i) => (
                  <span key={months[i]} class={`pl-num${past(months[i] as Month)}`}>
                    {t === 0 ? '' : plainEuros(t)}
                  </span>
                ))}
              </div>
              {isOpen &&
                s.lines.map((l) => (
                  <div key={l.id} class="pl-row table" aria-current={selected === l.id ? 'true' : undefined}>
                    <button type="button" class="budget-name" onClick={() => props.open(l.id)}>
                      <b>{l.label}</b>
                      <small class="caption pl-muted">{l.categoryPath}</small>
                    </button>
                    {l.cells.map((c) => {
                      const cls = `pl-num${c.past ? ' budget-past' : ''}${c.overridden ? ' budget-over' : ''}`
                      const text = c.amountCents === null ? '' : plainEuros(c.amountCents)
                      if (props.override && !c.past && c.amountCents !== null) {
                        const override = props.override
                        return (
                          <span key={c.month} class={cls}>
                            <button
                              type="button"
                              class="budget-cell"
                              aria-label={`Surcharger ${l.label}, ${monthTitle(c.month)} : ${euros(c.amountCents)}${c.overridden ? ', surchargé' : ''}`}
                              onClick={() => override(l.id, c.month)}
                            >
                              {text}
                            </button>
                          </span>
                        )
                      }
                      return (
                        <span key={c.month} class={cls} title={monthTitle(c.month)}>
                          {text}
                        </span>
                      )
                    })}
                  </div>
                ))}
            </Fragment>
          )
        })}
        <div class="pl-row pl-row--section budget-total">
          <span class="title-s">Prévu du mois</span>
          {props.net.map((n, i) => (
            <span key={months[i]} class={`pl-num title-s${past(months[i] as Month)}`}>
              {n === null ? '' : signedPlainEuros(n)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// Phone: one month

function PhoneMonth(props: { sections: BudgetSectionView[]; net: number; folded: Set<number>; toggle: (id: number) => void; open: (id: Id) => void }) {
  const { folded, toggle } = props
  return (
    <div class="pl-list month-list">
      {props.sections.map((s) => {
        const isOpen = !folded.has(s.id)
        return (
          <section key={s.id} aria-label={s.name}>
            <div class="pl-sechead budget-sechead">
              <button type="button" class="pl-row__toggle title-s sechead-toggle" aria-expanded={isOpen} onClick={() => toggle(s.id)}>
                <Icon name="chevron-bas" />
                {s.name}
              </button>
              <span class="pl-num title-s">{s.totals[0] ? euros(s.totals[0]) : ''}</span>
            </div>
            {isOpen &&
              s.lines.map((l: LineRow) => {
                const cell = l.cells[0]
                return (
                  <button type="button" key={l.id} class="pl-item item-button" onClick={() => props.open(l.id)}>
                    <span class="pl-item__a table">
                      <span>{l.label}</span>
                      <span class={`pl-num${cell?.overridden ? ' budget-over' : ''}`}>
                        {cell && cell.amountCents !== null ? euros(cell.amountCents) : <span class="pl-muted">—</span>}
                      </span>
                    </span>
                    <span class="pl-item__b caption">
                      <span>
                        {l.categoryPath} · {l.rhythm}
                        {l.upcomingOverrides > 0 ? ` · ${upcomingText(l.upcomingOverrides)}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
          </section>
        )
      })}
      <div class="pl-sechead budget-sechead">
        <span class="title-s">Prévu du mois</span>
        <span class="pl-num title-s">{signedEuros(props.net)}</span>
      </div>
    </div>
  )
}

export function BudgetScreen({ ctx, place, narrow, refresh }: { ctx: MonthContext; place: Place; narrow: boolean; refresh: () => Promise<void> }) {
  const [folded, toggle] = useFoldedSections()
  const [overriding, setOverriding] = useState<{ lineId: Id; month: Month } | null>(null)
  const bounds = budgetBounds(ctx)
  const month = clampBudgetMonth(place.month, bounds)
  const months = narrow ? [month] : yearMonths(month)
  const view = budgetView(ctx, months, month)
  const record = place.lineId === null ? null : lineRecord(ctx, place.lineId)
  const go = (m: Month) => navigate(pathOf(m, bounds))
  const open = (id: Id) => {
    if (narrow) navigate(pathOf(month, bounds, id))
    else navigate(pathOf(month, bounds, place.lineId === id ? null : id), { replace: true })
  }
  const empty = view.sections.every((s) => s.lines.length === 0)

  if (narrow && record) {
    return (
      <div class="detail-page">
        <header class="detail-page__head">
          <button type="button" class="pl-iconbtn" aria-label="Retour" onClick={() => back(pathOf(month, bounds))}>
            <Icon name="chevron-gauche" />
          </button>
          <div>
            <h1 class="title-m">{record.label}</h1>
            <span class="caption pl-muted">Ligne de budget</span>
          </div>
        </header>
        <div class="pl-panel detail-page__panel">
          <Record record={record} />
        </div>
      </div>
    )
  }

  if (narrow) {
    return (
      <div class="month month--phone">
        <section class="pl-band pl-band--phone" aria-label={`Lignes de budget, ${monthTitle(month)}`}>
          <div class="pl-band__top">
            <div class="pl-month">
              <button type="button" class="pl-iconbtn" aria-label="Mois précédent" disabled={month <= bounds.first} onClick={() => go(addMonths(month, -1))}>
                <Icon name="chevron-gauche" />
              </button>
              <div class="month-title">
                <h1 class="title-m">{monthTitle(month)}</h1>
                <span class="caption month-title__kind">
                  {month < bounds.current ? 'Mois passé' : month === bounds.current ? 'Mois en cours' : 'Mois à venir'} · lignes de budget
                </span>
              </div>
              <button type="button" class="pl-iconbtn" aria-label="Mois suivant" disabled={month >= bounds.last} onClick={() => go(addMonths(month, 1))}>
                <Icon name="chevron-droite" />
              </button>
            </div>
          </div>
        </section>
        {empty ? (
          <p class="body pl-muted month-empty">Aucune ligne de budget ce mois-ci.</p>
        ) : (
          <PhoneMonth sections={view.sections} net={view.net[0] ?? 0} folded={folded} toggle={toggle} open={open} />
        )}
      </div>
    )
  }

  const year = month.slice(0, 4)
  const close = () => navigate(pathOf(month, bounds), { replace: true })
  const target = overriding ? overrideTarget(ctx, overriding.lineId, overriding.month) : null
  const panelLine = place.newLine ? null : record
  return (
    <div class="month">
      <header class="ops-head">
        <div class="pl-month">
          <button
            type="button"
            class="pl-iconbtn"
            aria-label="Année précédente"
            disabled={Number(year) <= Number(bounds.first.slice(0, 4))}
            onClick={() => go(addMonths(month, -12))}
          >
            <Icon name="chevron-gauche" />
          </button>
          <div class="month-title">
            <h1 class="title-l">Budget</h1>
            <span class="caption pl-muted">Lignes de budget · {year}</span>
          </div>
          <button
            type="button"
            class="pl-iconbtn"
            aria-label="Année suivante"
            disabled={Number(year) >= Number(bounds.last.slice(0, 4))}
            onClick={() => go(addMonths(month, 12))}
          >
            <Icon name="chevron-droite" />
          </button>
        </div>
        <button type="button" class="pl-btn pl-btn--primary label" onClick={() => navigate(newLinePath(month === bounds.current ? null : month), { replace: true })}>
          <Icon name="plus" />
          Nouvelle ligne
        </button>
      </header>
      <div class="month__body">
        <div class="month-table">
          {empty ? (
            <p class="body pl-muted month-empty">Aucune ligne de budget en {year}.</p>
          ) : (
            <YearGrid
              sections={view.sections}
              months={view.months}
              net={view.net}
              current={bounds.current}
              selected={panelLine?.id ?? null}
              folded={folded}
              toggle={toggle}
              open={open}
              override={(lineId, m) => setOverriding({ lineId, month: m })}
            />
          )}
        </div>
        {place.newLine && (
          <NewLinePanel
            key={`new-${place.newLine.categoryId ?? ''}`}
            ctx={ctx}
            categoryId={place.newLine.categoryId}
            refresh={refresh}
            onClose={close}
            onCreated={(id) => navigate(pathOf(month, bounds, id), { replace: true })}
          />
        )}
        {panelLine && (
          <LinePanel key={panelLine.id} ctx={ctx} lineId={panelLine.id} sub={panelLine.categoryPath} refresh={refresh} onClose={close}>
            <Record record={panelLine} />
          </LinePanel>
        )}
      </div>
      {target && <OverrideDialog key={`${target.lineId}-${target.month}`} target={target} refresh={refresh} onClose={() => setOverriding(null)} />}
    </div>
  )
}
