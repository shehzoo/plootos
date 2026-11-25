// Screen 3.2, operations: the list of a month and the record of an operation, on a computer and
// on a phone (lot 6). Lot 9: « + Ajout manuel » (a + button on a phone), the record can be
// changed on a computer, « Catégoriser » opens screen 3.3. Import and balance check arrive in
// lot 10 and stay hidden until then (DECISIONS.md, 2026-11-25).

import { useState } from 'preact/hooks'
import { addMonths, type Id, type Month } from '../../../shared/src/engine'
import { count, eurosOrMinus, fullDate, monthTitle, shortDate, signedEuros } from '../format'
import { Icon } from '../icons'
import { checkText, type MonthContext } from '../month/view'
import { addingPath, back, CATEGORIZE_PATH, navigate, operationsPath, type Place } from '../router'
import { todoCount } from './entry'
import { RecordEditor } from './RecordEditor'
import {
  clampOperationsMonth,
  operationDetail,
  operationsBounds,
  operationsView,
  type OperationDetail,
  type OperationRow,
  type OperationsBounds,
  type OperationsView,
} from './view'

type Filter = 'all' | 'todo'

/** The current month has no month in its path. */
const pathOf = (month: Month, bounds: OperationsBounds, operationId: Id | null = null) =>
  operationsPath(month === bounds.current ? null : month, operationId)

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

function CategoryText({ row }: { row: OperationRow }) {
  return row.uncategorized ? (
    <span>
      <span class="pl-pill pl-pill--warn">À catégoriser</span>
    </span>
  ) : (
    <span>{row.categoryText}</span>
  )
}

function LabelText({ row }: { row: OperationRow }) {
  return (
    <span class="op-label">
      <span class="op-label__line" title={row.label}>
        {row.label || <span class="pl-muted">Sans libellé</span>}
        {row.manual && <span class="caption pl-muted"> · ajout manuel</span>}
      </span>
      {row.comment && <small class="caption pl-muted op-label__line">{row.comment}</small>}
    </span>
  )
}

function Filters({ view, filter, set }: { view: OperationsView; filter: Filter; set: (f: Filter) => void }) {
  return (
    <div class="pl-seg" role="group" aria-label="Filtrer les opérations">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => set('all')}>
        Toutes ({view.rows.length})
      </button>
      <button type="button" aria-pressed={filter === 'todo'} onClick={() => set('todo')}>
        À catégoriser ({view.uncategorizedCount})
      </button>
    </div>
  )
}

function Later({ view, month, bounds }: { view: OperationsView; month: Month; bounds: OperationsBounds }) {
  if (view.laterCount === 0 || month >= bounds.last) return null
  return (
    <p class="caption pl-muted ops-later">
      {view.laterCount > 1 ? `${view.laterCount} opérations déjà entrées comptent` : '1 opération déjà entrée compte'} dans un mois suivant (date de
      valeur).{' '}
      <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => navigate(pathOf(addMonths(month, 1), bounds))}>
        Voir
      </button>
    </p>
  )
}

/** Record of an operation: figures first, then what it is made of. */
function Record({ view }: { view: OperationDetail }) {
  return (
    <>
      <div>
        <b class="amount-l">{signedEuros(view.amountCents)}</b>
        <span class="caption pl-muted ops-record__sub">
          {fullDate(view.valueDate)}
          {view.manual ? ' · ajout manuel' : ''}
        </span>
      </div>
      <div class="pl-group">
        <h3 class="title-s">{view.split ? 'Répartition' : 'Catégorie'}</h3>
        {view.parts.map((p, i) => (
          <div key={i} class="pl-op table">
            <span>{p.uncategorized ? <span class="pl-pill pl-pill--warn">À catégoriser</span> : p.categoryText}</span>
            {view.split && <span class="pl-num">{signedEuros(p.amountCents)}</span>}
          </div>
        ))}
        {view.categorizedBy && <p class="caption pl-muted detail-note">Catégorisée par {view.categorizedBy}</p>}
      </div>
      {view.comment && (
        <div class="pl-group">
          <h3 class="title-s">Commentaire</h3>
          <p class="body detail-note">{view.comment}</p>
        </div>
      )}
      {view.bankLabel && (
        <div class="pl-group">
          <h3 class="title-s">Libellé de la banque</h3>
          <p class="body detail-note ops-record__bank">{view.bankLabel}</p>
        </div>
      )}
      <p class="caption pl-muted detail-note">
        {view.origin.manual ? 'Saisie' : 'Importée'} par {view.origin.by}
        {view.origin.on ? ` le ${fullDate(view.origin.on)}` : ''}
      </p>
    </>
  )
}

function MonthNav(props: { month: Month; bounds: OperationsBounds; narrow: boolean }) {
  const { month, bounds, narrow } = props
  const go = (m: Month) => navigate(pathOf(m, bounds))
  return (
    <div class="pl-month">
      <button type="button" class="pl-iconbtn" aria-label="Mois précédent" disabled={month <= bounds.first} onClick={() => go(addMonths(month, -1))}>
        <Icon name="chevron-gauche" />
      </button>
      <div class="month-title">
        <h1 class={narrow ? 'title-m' : 'title-l'}>{narrow ? monthTitle(month) : 'Opérations'}</h1>
        <span class={`caption${narrow ? ' month-title__kind' : ' pl-muted'}`}>{narrow ? 'Opérations' : monthTitle(month)}</span>
      </div>
      <button type="button" class="pl-iconbtn" aria-label="Mois suivant" disabled={month >= bounds.last} onClick={() => go(addMonths(month, 1))}>
        <Icon name="chevron-droite" />
      </button>
    </div>
  )
}

function Balance({ view, ctx, narrow }: { view: OperationsView; ctx: MonthContext; narrow: boolean }) {
  return (
    <div class="pl-stat">
      <span class="pl-stat__k label">Solde de l'appli au {shortDate(ctx.today)}</span>
      <span class={`pl-stat__v ${narrow ? 'amount-l' : 'amount-xl'}`}>{eurosOrMinus(view.appBalanceCents)}</span>
      <span class="pl-stat__s caption">{checkText(view.check, 'Jamais vérifié')}</span>
    </div>
  )
}

function ComputerTable({ rows, selected, open }: { rows: OperationRow[]; selected: Id | null; open: (id: Id) => void }) {
  return (
    <div class="pl-table ops-table">
      <div class="pl-row pl-row--head label">
        <span>Date</span>
        <span>Catégorie</span>
        <span>Libellé ou commentaire</span>
        <span class="pl-num">Montant</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} class="pl-row table month-row" aria-current={selected === r.id ? 'true' : undefined} {...opener(() => open(r.id))}>
          <span class="pl-muted">{shortDate(r.valueDate)}</span>
          <CategoryText row={r} />
          <LabelText row={r} />
          <span class="pl-num">{signedEuros(r.amountCents)}</span>
        </div>
      ))}
    </div>
  )
}

function PhoneList({ rows, open }: { rows: OperationRow[]; open: (id: Id) => void }) {
  return (
    <div class="pl-list month-list">
      {rows.map((r) => (
        <button type="button" key={r.id} class="pl-item item-button" onClick={() => open(r.id)}>
          <span class="pl-item__a table">
            <span>{r.uncategorized ? <span class="pl-pill pl-pill--warn">À catégoriser</span> : r.categoryText}</span>
            <span class="pl-num">{signedEuros(r.amountCents)}</span>
          </span>
          <span class="pl-item__b caption">
            <span class="op-label__line">
              {shortDate(r.valueDate)} · {r.label || 'Sans libellé'}
              {r.manual ? ' · ajout manuel' : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** « + Ajout manuel » on a phone: the floating + button (spec 3.0). */
export function AddButton() {
  return (
    <button type="button" class="pl-fab fab" aria-label="Ajout manuel" onClick={() => navigate(addingPath(window.location.pathname))}>
      <Icon name="plus" />
    </button>
  )
}

export function OperationsScreen({ ctx, place, narrow, refresh }: { ctx: MonthContext; place: Place; narrow: boolean; refresh: () => Promise<void> }) {
  const [filter, setFilter] = useState<Filter>('all')
  const bounds = operationsBounds(ctx)
  const month = clampOperationsMonth(place.month, bounds)
  const view = operationsView(ctx, month)
  const record = place.operationId === null ? null : operationDetail(ctx, place.operationId)
  const rows = filter === 'todo' ? view.rows.filter((r) => r.uncategorized) : view.rows

  const open = (id: Id) => {
    if (narrow) navigate(pathOf(month, bounds, id))
    else navigate(pathOf(month, bounds, place.operationId === id ? null : id), { replace: true })
  }

  if (narrow && record) {
    return (
      <div class="detail-page">
        <header class="detail-page__head">
          <button type="button" class="pl-iconbtn" aria-label="Retour" onClick={() => back(pathOf(month, bounds))}>
            <Icon name="chevron-gauche" />
          </button>
          <div>
            <h1 class="title-m">{record.title}</h1>
            <span class="caption pl-muted">Opération</span>
          </div>
        </header>
        <div class="pl-panel detail-page__panel">
          <Record view={record} />
        </div>
      </div>
    )
  }

  const empty = rows.length === 0 && (
    <p class="body pl-muted month-empty">
      {filter === 'todo' ? 'Aucune opération à catégoriser ce mois-ci.' : 'Aucune opération ce mois-ci.'}
    </p>
  )

  if (narrow) {
    return (
      <div class="month month--phone">
        <section class="pl-band pl-band--phone" aria-label={`Opérations, ${monthTitle(month)}`}>
          <div class="pl-band__top">
            <MonthNav month={month} bounds={bounds} narrow />
          </div>
          <div class="pl-stats">
            <Balance view={view} ctx={ctx} narrow />
          </div>
        </section>
        <div class="ops-filters">
          <Filters view={view} filter={filter} set={setFilter} />
        </div>
        {empty || <PhoneList rows={rows} open={open} />}
        <Later view={view} month={month} bounds={bounds} />
        <AddButton />
      </div>
    )
  }
  const todo = todoCount(ctx)
  const operation = record ? ctx.ledger.data.operations.find((o) => o.id === record.id) : undefined
  const rowVersion = record ? (ctx.app.operations.find((o) => o.id === record.id)?.rowVersion ?? 1) : 1
  return (
    <div class="month">
      <header class="ops-head">
        <MonthNav month={month} bounds={bounds} narrow={false} />
        <Balance view={view} ctx={ctx} narrow={false} />
        <div class="pl-actions ops-head__actions">
          <button type="button" class="pl-btn pl-btn--primary label" onClick={() => navigate(addingPath(window.location.pathname))}>
            <Icon name="plus" />
            Ajout manuel
          </button>
        </div>
      </header>
      <div class="ops-filters">
        <Filters view={view} filter={filter} set={setFilter} />
        <span class="caption pl-muted">{count(view.rows.length, 'opération')} en {monthTitle(month).toLowerCase()}</span>
        {todo > 0 && (
          <button type="button" class="pl-btn label ops-categorize" onClick={() => navigate(CATEGORIZE_PATH)}>
            Catégoriser ({todo})
          </button>
        )}
      </div>
      <div class="month__body">
        <div class="month-table">
          {empty || <ComputerTable rows={rows} selected={record?.id ?? null} open={open} />}
          <Later view={view} month={month} bounds={bounds} />
        </div>
        {record && (
          <aside class="pl-panel month-panel" aria-label={`Opération : ${record.title}`}>
            <div class="month-panel__head">
              <h2 class="title-m">{record.title}</h2>
              <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => navigate(pathOf(month, bounds), { replace: true })}>
                Fermer
              </button>
            </div>
            {operation ? (
              <RecordEditor
                key={record.id}
                ctx={ctx}
                operation={operation}
                rowVersion={rowVersion}
                view={record}
                refresh={refresh}
                onDeleted={() => navigate(pathOf(month, bounds), { replace: true })}
              />
            ) : (
              <Record view={record} />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
