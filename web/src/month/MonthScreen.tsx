// Screens 3.1 (current month, and a future month: the planned only) and 3.4 (closed month),
// on a computer and on a phone (lot 5). Drawn with the design system's classes (pl-*,
// DESIGN.md); the figures come from ./view.ts.
//
// Lot 8: in the detail of a category, a line's name opens it in Budget; on a computer,
// « Surcharger ce mois » (current or later month) and, for an off-budget category of a closed
// month, « Ajouter une ligne de budget » (DECISIONS.md, 2026-11-25).
//
// Lot 9: « + Ajout manuel » (the + button on a phone), except on a future month; « Catégoriser »
// on a computer; an operation in the detail of a category opens its record.
//
// Lot 10: « Importer relevé bancaire (XLSX) » on a computer (spec 3.0).
//
// Lot 11: on a computer, the reminder to export on the current month (spec 3.8).

import { Fragment, type ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { exportDue } from '../../../shared/src/backup'
import { lastDayOfMonth, addMonths, monthOf, type Id, type Month } from '../../../shared/src/engine'
import { useExport } from '../budget/backup'
import { useFoldedSections } from '../display'
import { count, euros, eurosOrMinus, fullDate, monthName, monthTitle, shortDate, signedEuros } from '../format'
import { Icon } from '../icons'
import { OverrideDialog } from '../budget/LineEditor'
import { overrideTarget } from '../budget/lines'
import { AddButton } from '../operations/OperationsScreen'
import { addingPath, back, budgetPath, CATEGORIZE_PATH, IMPORT_PATH, monthPath, navigate, newLinePath, operationsPath, type Place } from '../router'
import {
  band,
  checkText,
  clampMonth,
  detail,
  gapText,
  kindOf,
  monthBounds,
  monthGapText,
  remainderText,
  sections,
  type Band,
  type CategoryRow,
  type DetailView,
  type MonthBounds,
  type MonthContext,
  type MonthKind,
  type Remainder,
  type SectionView,
} from './view'

const KIND_LABEL: Record<MonthKind, string> = {
  current: 'Mois en cours',
  future: 'Mois à venir : prévu seul',
  closed: 'Mois terminé',
}

/** The current month has no month in its path ("/"). */
const pathOf = (month: Month, bounds: MonthBounds, categoryId: Id | null = null) =>
  monthPath(month === bounds.current ? null : month, categoryId)

// Small pieces

function Stat({ label, value, sub, pill, narrow, action }: { label: string; value: string; sub?: string; pill?: string; narrow: boolean; action?: ComponentChildren }) {
  return (
    <div class="pl-stat">
      <span class="pl-stat__k label">
        {label}
        {pill && (
          <>
            {' '}
            <span class="pl-pill pl-pill--approx">{pill}</span>
          </>
        )}
      </span>
      <span class={`pl-stat__v ${narrow ? 'amount-l' : 'amount-xl'}`}>{value}</span>
      {sub && <span class="pl-stat__s caption">{sub}</span>}
      {action}
    </div>
  )
}

function remainderClass(r: Remainder, sub: boolean): string {
  if (r.kind === 'over') return 'pl-over'
  if (r.kind === 'extra') return 'text-primary'
  if (r.kind === 'amount') return sub ? 'pl-muted' : ''
  return 'pl-muted'
}

function RemainderText({ r, sub = false }: { r: Remainder; sub?: boolean }) {
  const text = remainderText(r)
  return text ? <span class={remainderClass(r, sub)}>{text}</span> : null
}

function GapText({ row, parentBad = false }: { row: CategoryRow; parentBad?: boolean }) {
  const text = gapText(row.gap, row.direction)
  if (!text) return null
  // A subcategory is not coloured again when its category already is (maquette 3.4).
  const cls = row.gap?.bad && !parentBad ? 'pl-over' : row.level === 2 ? 'pl-muted' : ''
  return <span class={cls}>{text}</span>
}

function PlannedText({ row }: { row: CategoryRow }) {
  if (row.status === 'budgeted') return <span class={row.level === 2 ? 'pl-muted' : ''}>{euros(row.plannedCents)}</span>
  if (row.withinName) return <span class="pl-muted">dans {row.withinName}</span>
  return <span class="pl-muted">—</span>
}

function Bar({ row }: { row: CategoryRow }) {
  if (!row.progress) return null
  const pct = Math.round(row.progress.ratio * 100)
  return (
    <div
      class={`pl-bar${row.progress.over ? ' pl-bar--over' : ''}`}
      role="progressbar"
      aria-label={`Avancement : ${row.name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

function Summary({ section }: { section: SectionView }) {
  return (
    <>
      {section.summary.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && ', '}
          <span class={p.over ? 'pl-over' : ''}>{p.text}</span>
        </Fragment>
      ))}
    </>
  )
}

function FoldButton({ section, open, onToggle }: { section: SectionView; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" class="pl-row__toggle title-s" aria-expanded={open} onClick={onToggle}>
      <Icon name="chevron-bas" />
      {section.name}
    </button>
  )
}

/** Keyboard and mouse: a row that opens a detail. */
function opener(open: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    },
  }
}

// Band (MonthBand), on a computer and on a phone

function MonthBand(props: {
  month: Month
  kind: MonthKind
  bounds: MonthBounds
  data: Band
  narrow: boolean
}) {
  const { month, kind, bounds, data, narrow } = props
  const end = shortDate(lastDayOfMonth(month))
  const stats: ComponentChildren[] = []
  if (data.kind === 'current') {
    let projectedSub: string
    if (data.approximate) {
      const n = data.monthUncategorizedCount
      projectedSub = `${count(n, 'opération')} à catégoriser (${signedEuros(data.monthUncategorizedCents)})`
    } else if (data.remainingOutCents > 0 && data.remainingInCents > 0) {
      projectedSub = 'Si les restes sont dépensés et les entrées attendues reçues'
    } else if (data.remainingOutCents > 0) {
      projectedSub = 'Si les restes sont dépensés'
    } else if (data.remainingInCents > 0) {
      projectedSub = 'Si les entrées attendues sont reçues'
    } else {
      projectedSub = 'Le budget du mois est passé'
    }
    stats.push(
      <Stat key="app" label="Solde de l'appli" value={eurosOrMinus(data.appBalanceCents)} sub={checkText(data.check, 'Jamais vérifié')} narrow={narrow} />,
      <Stat
        key="end"
        label={`Solde prévu au ${end}`}
        pill={data.approximate ? 'Approximatif' : undefined}
        value={eurosOrMinus(data.projectedCents)}
        sub={projectedSub}
        narrow={narrow}
      />,
    )
    if (!narrow) {
      const n = data.uncategorizedCount
      const m = data.monthUncategorizedCount
      const sub = n === 0 ? 'Tout est catégorisé' : m === n ? 'Ce mois-ci' : m === 0 ? "Dans d'autres mois" : `Dont ${m} ce mois-ci`
      const action =
        n > 0 ? (
          <button type="button" class="pl-band__link label" onClick={() => navigate(CATEGORIZE_PATH)}>
            Catégoriser
          </button>
        ) : undefined
      stats.push(<Stat key="todo" label="À catégoriser" value={String(n)} sub={sub} narrow={narrow} action={action} />)
    }
  } else if (data.kind === 'future') {
    stats.push(
      <Stat key="end" label={`Solde prévu au ${end}`} value={eurosOrMinus(data.projectedCents)} sub="Selon le budget" narrow={narrow} />,
      <Stat key="planned" label="Prévu du mois" value={signedEuros(data.plannedNetCents)} sub="Entrées moins dépenses prévues" narrow={narrow} />,
    )
  } else {
    stats.push(
      <Stat key="end" label={`Solde au ${end}`} value={eurosOrMinus(data.endBalanceCents)} sub={checkText(data.check, 'Pas de vérification ce mois-ci')} narrow={narrow} />,
    )
    if (!narrow) {
      stats.push(
        <Stat key="budget" label="Solde au budget" value={eurosOrMinus(data.plannedEndBalanceCents)} sub="Solde de début de mois plus le prévu" narrow={narrow} />,
      )
    }
    // On a phone the words go under the amount: « 398 € de mieux » does not fit in half a band.
    const budget = eurosOrMinus(data.plannedEndBalanceCents)
    const words = data.gapCents > 0 ? 'de mieux' : data.gapCents < 0 ? 'de moins' : 'comme'
    stats.push(
      narrow ? (
        <Stat key="gap" label="Écart" value={euros(data.gapCents)} sub={`${words} que le solde au budget (${budget})`} narrow />
      ) : (
        <Stat key="gap" label="Écart" value={monthGapText(data.gapCents)} sub="que le solde au budget" narrow={false} />
      ),
    )
  }
  const go = (m: Month) => navigate(pathOf(m, bounds))
  return (
    <section class={`pl-band${narrow ? ' pl-band--phone' : ''}`} aria-label={`${monthTitle(month)}, ${KIND_LABEL[kind].toLowerCase()}`}>
      <div class="pl-band__top">
        <div class="pl-month">
          <button type="button" class="pl-iconbtn" aria-label="Mois précédent" disabled={month <= bounds.first} onClick={() => go(addMonths(month, -1))}>
            <Icon name="chevron-gauche" />
          </button>
          <div class="month-title">
            <h1 class={narrow ? 'title-m' : 'title-l'}>{monthTitle(month)}</h1>
            <span class="caption month-title__kind">{KIND_LABEL[kind]}</span>
          </div>
          <button type="button" class="pl-iconbtn" aria-label="Mois suivant" disabled={month >= bounds.last} onClick={() => go(addMonths(month, 1))}>
            <Icon name="chevron-droite" />
          </button>
        </div>
        {!narrow && (
          <div class="pl-actions">
            {kind !== 'current' && (
              <button type="button" class="pl-btn label" onClick={() => go(bounds.current)}>
                Mois en cours
              </button>
            )}
            {kind !== 'future' && (
              <button type="button" class="pl-btn label" onClick={() => navigate(IMPORT_PATH)}>
                Importer relevé bancaire (XLSX)
              </button>
            )}
            {kind !== 'future' && (
              <button type="button" class="pl-btn pl-btn--primary label" onClick={() => navigate(addingPath(window.location.pathname))}>
                <Icon name="plus" />
                Ajout manuel
              </button>
            )}
          </div>
        )}
      </div>
      <div class={`pl-stats${stats.length === 2 && !narrow ? ' stats-2' : ''}`}>{stats}</div>
    </section>
  )
}

function UncategorizedBanner({ month, data, narrow }: { month: Month; data: Band; narrow: boolean }) {
  if (data.kind === 'closed' && data.monthUncategorizedCount > 0) {
    const n = data.monthUncategorizedCount
    return (
      <div class="pl-banner body month-banner" role="status">
        <span>
          {count(n, 'opération')} de {monthName(month)} {n > 1 ? 'sont' : 'est'} à catégoriser : le réel est incomplet.
        </span>
        {!narrow && (
          <button type="button" onClick={() => navigate(CATEGORIZE_PATH)}>
            Catégoriser
          </button>
        )}
      </div>
    )
  }
  // On a phone, the count of the computer's band becomes a banner, only when there are some.
  if (narrow && data.kind === 'current' && data.uncategorizedCount > 0) {
    const n = data.uncategorizedCount
    return (
      <div class="pl-banner body month-banner" role="status">
        <span>
          {count(n, 'opération')} à catégoriser{data.approximate ? ' : le solde prévu est approximatif.' : '.'}
        </span>
      </div>
    )
  }
  return null
}

/**
 * More than a month since the last export (or since setup, without any): a banner and its
 * button, on the current month, on a computer (spec 3.8, DECISIONS.md 2026-11-25).
 */
function ExportReminder({ ctx, refresh }: { ctx: MonthContext; refresh: () => Promise<void> }) {
  const { busy, message, run } = useExport(refresh)
  const opening = ctx.app.openingBalance
  const since = ctx.lastExportAt === undefined || !opening ? null : exportDue(ctx.lastExportAt, opening.createdAt, ctx.today)
  if (since === null && !message) return null
  if (since === null) {
    return (
      <div class="pl-banner body month-banner" role="status">
        <span>{message?.text}</span>
      </div>
    )
  }
  return (
    <div class={`pl-banner body month-banner${message?.kind === 'error' ? ' pl-banner--over' : ''}`} role="status">
      <span>
        {message?.kind === 'error'
          ? message.text
          : ctx.lastExportAt
            ? `Le dernier export date du ${fullDate(since)} : plus d'un mois.`
            : `Aucun export depuis la mise en service (${fullDate(since)}), il y a plus d'un mois.`}
      </span>
      <button type="button" onClick={run} disabled={busy}>
        {busy ? 'Export…' : 'Exporter'}
      </button>
    </div>
  )
}

// Computer: BudgetTable and DetailPanel

function CategoryCells({ row, kind, parentBad }: { row: CategoryRow; kind: MonthKind; parentBad: boolean }) {
  const sub = row.level === 2
  return (
    <>
      <span class="pl-row__name">
        {row.name}
        {kind === 'closed' && row.level === 1 && row.status === 'off_budget' && <span class="caption pl-muted"> · hors budget</span>}
      </span>
      <span class="pl-num">
        <PlannedText row={row} />
      </span>
      {kind !== 'future' && <span class="pl-num">{eurosOrMinus(row.actualCents)}</span>}
      {kind === 'current' && (
        <>
          <span class="pl-num">
            <RemainderText r={row.remainder} sub={sub} />
          </span>
          <span>
            <Bar row={row} />
          </span>
        </>
      )}
      {kind === 'closed' && (
        <span class="pl-num">
          <GapText row={row} parentBad={parentBad} />
        </span>
      )}
    </>
  )
}

function BudgetTable(props: {
  sections: SectionView[]
  kind: MonthKind
  selected: Id | null
  folded: Set<number>
  toggle: (id: number) => void
  open: (id: Id) => void
  total: { plannedCents: number; actualCents: number; gapCents: number } | null
}) {
  const { kind, selected, folded, toggle, open, total } = props
  return (
    <div class={`pl-table month-table month-table--${kind}`}>
      <div class="pl-row pl-row--head label">
        <span>Catégorie</span>
        <span class="pl-num">Prévu</span>
        {kind !== 'future' && <span class="pl-num">Réel</span>}
        {kind === 'current' && (
          <>
            <span class="pl-num">Reste</span>
            <span>Avancement</span>
          </>
        )}
        {kind === 'closed' && <span class="pl-num">Écart</span>}
      </div>
      {props.sections.map((s) => {
        const isOpen = !folded.has(s.id)
        return (
          <div key={s.id} class="month-table__section">
            <div class="pl-row pl-row--section">
              <FoldButton section={s} open={isOpen} onToggle={() => toggle(s.id)} />
              <span class="pl-num title-s">{s.budgeted ? euros(s.plannedCents) : <span class="pl-muted">—</span>}</span>
              {kind !== 'future' && <span class="pl-num title-s">{eurosOrMinus(s.actualCents)}</span>}
              {kind !== 'future' && (
                <span class="pl-row__sum label pl-muted">
                  <Summary section={s} />
                </span>
              )}
            </div>
            {isOpen &&
              s.rows.map((r) => (
                <Fragment key={r.id}>
                  <div class="pl-row table month-row" aria-current={selected === r.id ? 'true' : undefined} {...opener(() => open(r.id))}>
                    <CategoryCells row={r} kind={kind} parentBad={false} />
                  </div>
                  {r.children.map((c) => (
                    <div
                      key={`${c.id}-${c.withoutDetail}`}
                      class="pl-row table pl-row--sub month-row"
                      aria-current={selected === c.id && !c.withoutDetail ? 'true' : undefined}
                      {...opener(() => open(c.withoutDetail ? r.id : c.id))}
                    >
                      <CategoryCells row={c} kind={kind} parentBad={!!r.gap?.bad && r.gap.cents !== 0} />
                    </div>
                  ))}
                </Fragment>
              ))}
          </div>
        )
      })}
      {total && (
        <div class="pl-row pl-row--section month-table__total">
          <span class="title-s">Solde du mois</span>
          <span class="pl-num title-s">{signedEuros(total.plannedCents)}</span>
          <span class="pl-num title-s">{signedEuros(total.actualCents)}</span>
          <span class="pl-num title-s">{monthGapText(total.gapCents)}</span>
        </div>
      )}
    </div>
  )
}

function Figures({ view, kind }: { view: DetailView; kind: MonthKind }) {
  const r = view.row
  // [label, value, class of the value]
  const cells: [string, string, string][] = []
  cells.push(['Prévu', r.status === 'budgeted' ? euros(r.plannedCents) : '—', ''])
  if (kind !== 'future') cells.push(['Réel', eurosOrMinus(r.actualCents), ''])
  if (kind === 'current') {
    const rem = r.remainder
    if (rem.kind === 'amount') cells.push(['Reste', euros(rem.cents), ''])
    else if (rem.kind === 'settled') cells.push(['Reste', 'soldé', ''])
    else if (rem.kind === 'cancelled') cells.push(['Reste', 'annulée', ''])
    else if (rem.kind === 'over') cells.push(['Dépassé de', euros(rem.cents), 'pl-over'])
    else if (rem.kind === 'extra') cells.push(['Reçu en plus', euros(rem.cents), 'text-primary'])
  }
  if (kind === 'closed' && r.gap) {
    const g = r.gap
    const words = r.direction === 'out' ? (g.cents > 0 ? 'Dépensé en plus' : 'Dépensé en moins') : g.cents > 0 ? 'Reçu en plus' : 'Reçu en moins'
    cells.push([g.cents === 0 ? 'Écart' : words, euros(g.cents), g.bad && g.cents !== 0 ? 'pl-over' : ''])
  }
  let note = ''
  if (r.status === 'off_budget' && r.level === 1) note = 'Hors budget : aucune ligne ce mois-ci.'
  if (r.withinName) note = `Pas de ligne propre : son réel compte dans le reste de ${r.withinName}.`
  return (
    <>
      <div class="pl-kv">
        {cells.map(([k, v, cls]) => (
          <div key={k}>
            <span class="label">{k}</span>
            <b class={`amount-m ${cls}`}>{v}</b>
          </div>
        ))}
      </div>
      {note && <p class="caption pl-muted detail-note">{note}</p>}
    </>
  )
}

/** Writing from the detail of a category, on a computer only (spec 3.0). */
interface DetailActions {
  override: (lineId: Id) => void
  addLine: () => void
}

function DetailContent(props: { view: DetailView; month: Month; kind: MonthKind; bounds: MonthBounds; openSub?: (id: Id) => void; actions?: DetailActions }) {
  const { view, month, kind, openSub, actions } = props
  // A line opens in Budget, at its month (a computer shows the year).
  const openLine = (id: Id) => navigate(budgetPath(month === props.bounds.current ? null : month, id))
  return (
    <>
      <Figures view={view} kind={kind} />
      {openSub && view.children.length > 0 && (
        <div class="pl-group">
          <h3 class="title-s">Sous-catégories</h3>
          {view.children.map((c) => (
            <button type="button" key={c.id} class="pl-op table op-button" onClick={() => openSub(c.id)}>
              <span>
                {c.name}
                <small class="caption">
                  {kind === 'future'
                    ? `${euros(c.plannedCents)} prévus`
                    : c.status === 'budgeted'
                      ? `${eurosOrMinus(c.actualCents)} sur ${euros(c.plannedCents)}`
                      : c.withinName
                        ? `${eurosOrMinus(c.actualCents)}, dans ${c.withinName}`
                        : eurosOrMinus(c.actualCents)}
                </small>
              </span>
              <span class="pl-num">{kind === 'closed' ? <GapText row={c} /> : <RemainderText r={c.remainder} />}</span>
            </button>
          ))}
        </div>
      )}
      <div class="pl-group">
        <h3 class="title-s">Lignes de budget en {monthName(month)}</h3>
        {view.lines.length === 0 && <p class="caption pl-muted detail-note">{view.noLines}</p>}
        {view.lines.map((l) => (
          <div key={l.budgetLineId} class="pl-op table">
            <span>
              <button type="button" class="detail-link" onClick={() => openLine(l.budgetLineId)}>
                {l.label}
              </button>
              <small class="caption">{l.caption}</small>
              {actions && kind !== 'closed' && (
                <button type="button" class="pl-btn pl-btn--ghost label detail-action" onClick={() => actions.override(l.budgetLineId)}>
                  Surcharger ce mois
                </button>
              )}
            </span>
            <span class="pl-num">{euros(l.amountCents)}</span>
          </div>
        ))}
        {actions && kind === 'closed' && view.row.status === 'off_budget' && (
          <button type="button" class="pl-btn label detail-add" onClick={actions.addLine}>
            <Icon name="plus" />
            Ajouter une ligne de budget
          </button>
        )}
      </div>
      {view.operations && (
        <div class="pl-group">
          <h3 class="title-s">Opérations ({view.operations.length})</h3>
          {view.operations.length === 0 && <p class="caption pl-muted detail-note">Aucune opération ce mois-ci.</p>}
          {view.operations.map((o) => (
            <button type="button" key={o.id} class="pl-op table op-button" onClick={() => navigate(operationsPath(monthOf(o.valueDate) === props.bounds.current ? null : monthOf(o.valueDate), o.id))}>
              <span class="op-label">
                <span class="op-label__line" title={o.label}>
                  <span class="pl-muted">{shortDate(o.valueDate)}</span> {o.label}
                </span>
                {o.caption && <small class="caption">{o.caption}</small>}
              </span>
              <span class="pl-num">{signedEuros(o.amountCents)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function DetailPanel({ view, month, kind, bounds, close, actions }: { view: DetailView; month: Month; kind: MonthKind; bounds: MonthBounds; close: () => void; actions: DetailActions }) {
  return (
    <aside class="pl-panel month-panel" aria-label={`Détail : ${view.name}`}>
      <div class="month-panel__head">
        <div>
          <h2 class="title-m">{view.name}</h2>
          <span class="caption pl-muted">{view.context}</span>
        </div>
        <button type="button" class="pl-btn pl-btn--ghost label" onClick={close}>
          Fermer
        </button>
      </div>
      <DetailContent view={view} month={month} kind={kind} bounds={bounds} actions={actions} />
    </aside>
  )
}

// Phone: CategoryItem list and the detail screen

function PhoneList(props: { sections: SectionView[]; kind: MonthKind; folded: Set<number>; toggle: (id: number) => void; open: (id: Id) => void }) {
  const { kind, folded, toggle, open } = props
  return (
    <div class="pl-list month-list">
      {props.sections.map((s) => {
        const isOpen = !folded.has(s.id)
        return (
          <section key={s.id} aria-label={s.name}>
            <div class="pl-sechead">
              <button type="button" class="pl-row__toggle title-s sechead-toggle" aria-expanded={isOpen} onClick={() => toggle(s.id)}>
                <Icon name="chevron-bas" />
                {s.name}
              </button>
              <span class="pl-sechead__sum caption">
                <Summary section={s} />
              </span>
            </div>
            {isOpen &&
              s.rows.map((r) => (
                <button type="button" key={r.id} class="pl-item item-button" onClick={() => open(r.id)}>
                  <span class="pl-item__a table">
                    <span>
                      {r.name}
                      {kind === 'closed' && r.status === 'off_budget' && <span class="caption pl-muted"> · hors budget</span>}
                    </span>
                    <span class="pl-num">
                      {kind === 'future' ? euros(r.plannedCents) : kind === 'closed' ? <GapText row={r} /> : <RemainderText r={r.remainder} />}
                    </span>
                  </span>
                  <Bar row={r} />
                  {kind !== 'future' && (
                    <span class="pl-item__b caption">
                      <span class="pl-num">
                        {r.status === 'budgeted' ? `${eurosOrMinus(r.actualCents)} sur ${euros(r.plannedCents)}` : eurosOrMinus(r.actualCents)}
                      </span>
                      {r.subOverruns.length > 0 && (
                        <span class="pl-over">
                          {r.subOverruns.map((o) => (kind === 'closed' ? `${o.name} : ${o.text}` : `${o.name} ${o.text}`)).join(' · ')}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              ))}
          </section>
        )
      })}
    </div>
  )
}

function PhoneDetail({ view, month, kind, bounds }: { view: DetailView; month: Month; kind: MonthKind; bounds: MonthBounds }) {
  const up = view.parentId === null ? pathOf(month, bounds) : pathOf(month, bounds, view.parentId)
  return (
    <div class="detail-page">
      <header class="detail-page__head">
        <button type="button" class="pl-iconbtn" aria-label="Retour" onClick={() => back(up)}>
          <Icon name="chevron-gauche" />
        </button>
        <div>
          <h1 class="title-m">{view.name}</h1>
          <span class="caption pl-muted">
            {monthTitle(month)} · {view.context}
          </span>
        </div>
      </header>
      <div class="pl-panel detail-page__panel">
        <DetailContent view={view} month={month} kind={kind} bounds={bounds} openSub={(id) => navigate(pathOf(month, bounds, id))} />
      </div>
    </div>
  )
}

// The screen

export function MonthScreen({ ctx, place, narrow, refresh }: { ctx: MonthContext; place: Place; narrow: boolean; refresh: () => Promise<void> }) {
  const [folded, toggle] = useFoldedSections()
  const [overriding, setOverriding] = useState<Id | null>(null)
  const bounds = monthBounds(ctx)
  const month = clampMonth(place.month, bounds)
  const kind = kindOf(month, bounds)

  // A month outside the bounds, or the current month written in full: back to "/".
  useEffect(() => {
    if (place.month !== null && (place.month !== month || month === bounds.current)) {
      navigate(pathOf(month, bounds, place.categoryId), { replace: true })
    }
  }, [place.month, month, bounds.current])

  const list = sections(ctx, month, kind)
  const data = band(ctx, month, kind, bounds)
  const view = place.categoryId === null ? null : detail(ctx, month, kind, place.categoryId)

  const open = (id: Id) => {
    if (narrow) navigate(pathOf(month, bounds, id))
    else navigate(pathOf(month, bounds, place.categoryId === id ? null : id), { replace: true })
  }

  const target = overriding === null || narrow ? null : overrideTarget(ctx, overriding, month)

  if (narrow && view) return <PhoneDetail view={view} month={month} kind={kind} bounds={bounds} />

  const empty = list.length === 0 && (
    <p class="body pl-muted month-empty">
      {kind === 'future' ? 'Aucune ligne de budget ce mois-là.' : 'Aucune ligne de budget ni opération ce mois-ci.'}
    </p>
  )
  const total =
    kind === 'closed' && data.kind === 'closed'
      ? { plannedCents: ctx.ledger.plannedNet(month), actualCents: ctx.ledger.monthSummary(month).actualNetCents, gapCents: data.gapCents }
      : null

  if (narrow) {
    return (
      <div class="month month--phone">
        <MonthBand month={month} kind={kind} bounds={bounds} data={data} narrow />
        <UncategorizedBanner month={month} data={data} narrow />
        {empty || <PhoneList sections={list} kind={kind} folded={folded} toggle={toggle} open={open} />}
        {kind !== 'future' && <AddButton />}
      </div>
    )
  }
  return (
    <div class="month">
      <MonthBand month={month} kind={kind} bounds={bounds} data={data} narrow={false} />
      {kind === 'current' && <ExportReminder ctx={ctx} refresh={refresh} />}
      <UncategorizedBanner month={month} data={data} narrow={false} />
      <div class="month__body">
        {empty || (
          <BudgetTable sections={list} kind={kind} selected={view?.id ?? null} folded={folded} toggle={toggle} open={open} total={total} />
        )}
        {view && (
          <DetailPanel
            view={view}
            month={month}
            kind={kind}
            bounds={bounds}
            close={() => navigate(pathOf(month, bounds), { replace: true })}
            actions={{ override: setOverriding, addLine: () => navigate(newLinePath(null, view.id)) }}
          />
        )}
      </div>
      {target && <OverrideDialog key={`${target.lineId}-${target.month}`} target={target} refresh={refresh} onClose={() => setOverriding(null)} />}
    </div>
  )
}
