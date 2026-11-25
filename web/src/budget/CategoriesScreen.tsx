// Screen 3.7, categories (computer only): sections, categories and subcategories in their
// order; creating, renaming, moving, archiving and reordering (lot 7). A new row of input opens
// in the list; the panel changes or archives the selected element. Every write goes through
// `useWriter`: the data are reloaded after it, and "Modifié entre-temps" keeps the screen.

import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import type { ArchiveRequest, NewCategoryRequest, NewSectionRequest, OrderRequest, UpdateRequest } from '../../../shared/src/api'
import { monthOf } from '../../../shared/src/engine'
import { apiSend } from '../api'
import { useFoldedSections } from '../display'
import { count } from '../format'
import { Icon } from '../icons'
import type { MonthContext } from '../month/view'
import { catalogView, type CatalogCategory, type CatalogItem, type CatalogSection } from './catalog'
import { useWriter, type Message } from './write'

type Pick = { kind: 'section' | 'category'; id: number }
type Adding = { kind: 'section' } | { kind: 'category'; sectionId: number } | { kind: 'sub'; parentId: number }

const sameSense = (d: 'in' | 'out') => (d === 'in' ? 'Entrées' : 'Sorties')
const linesText = (n: number) => (n === 0 ? 'Aucune ligne' : count(n, 'ligne'))

/** Row of input at the end of a list: a name (and for a section, its direction), then « Créer ». */
function AddRow(props: {
  label: string
  withDirection?: boolean
  /** Shown before the first creation (R10): the person confirms by pressing the button again. */
  warning?: string | null
  busy: boolean
  onCreate: (name: string, direction: 'in' | 'out', confirmed: boolean) => Promise<boolean>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [warned, setWarned] = useState(false)
  const submit = async (e: Event) => {
    e.preventDefault()
    if (name.trim() === '') return
    if (props.warning && !warned) return setWarned(true)
    await props.onCreate(name, direction, warned)
  }
  return (
    <form class="catalog-add" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}>
      <div class="catalog-add__fields">
        <label class="pl-field">
          <span class="pl-field__label label">{props.label}</span>
          <span class="pl-input catalog-text">
            <input
              type="text"
              maxLength={200}
              autoFocus
              value={name}
              onInput={(e) => {
                setName((e.target as HTMLInputElement).value)
                setWarned(false)
              }}
            />
          </span>
        </label>
        {props.withDirection && (
          <div class="pl-seg" role="group" aria-label="Sens de la section">
            <button type="button" aria-pressed={direction === 'in'} onClick={() => setDirection('in')}>
              Entrée
            </button>
            <button type="button" aria-pressed={direction === 'out'} onClick={() => setDirection('out')}>
              Sortie
            </button>
          </div>
        )}
        <div class="pl-actions">
          <button type="submit" class="pl-btn pl-btn--primary label" disabled={props.busy || name.trim() === ''}>
            {warned ? 'Confirmer et créer' : 'Créer'}
          </button>
          <button type="button" class="pl-btn pl-btn--ghost label" onClick={props.onCancel}>
            Annuler
          </button>
        </div>
      </div>
      {warned && props.warning && (
        <p class="caption catalog-warning" role="alert">
          {props.warning}
        </p>
      )}
      {props.withDirection && <p class="caption pl-muted">Le sens d'une section se choisit maintenant et ne change plus.</p>}
    </form>
  )
}

function Arrows(props: { name: string; first: boolean; last: boolean; busy: boolean; move: (delta: -1 | 1) => void }) {
  return (
    <span class="pl-actions catalog-arrows">
      <button type="button" class="pl-iconbtn catalog-up" aria-label={`Monter ${props.name}`} disabled={props.busy || props.first} onClick={() => props.move(-1)}>
        <Icon name="chevron-bas" />
      </button>
      <button type="button" class="pl-iconbtn" aria-label={`Descendre ${props.name}`} disabled={props.busy || props.last} onClick={() => props.move(1)}>
        <Icon name="chevron-bas" />
      </button>
    </span>
  )
}

/** Panel of the selected element: name, section (level 1), archiving with its confirmation. */
function Panel(props: {
  pick: Pick
  item: CatalogItem
  /** Level 1 category: the sections it can move to (same direction), and its current one. */
  sections: { id: number; name: string }[] | null
  sectionId: number | null
  parentName: string | null
  subCount: number
  busy: boolean
  message: Message | null
  onClose: () => void
  onUpdate: (body: Omit<UpdateRequest, 'rowVersion'>) => Promise<boolean>
  onArchive: () => Promise<boolean>
}) {
  const { item } = props
  const [name, setName] = useState(item.name)
  const [confirming, setConfirming] = useState(false)
  const title = props.pick.kind === 'section' ? 'Section' : props.parentName ? 'Sous-catégorie' : 'Catégorie'
  const blocked = item.lines > 0
  return (
    <aside class="pl-panel month-panel" aria-label={`${title} : ${item.name}`}>
      <div class="month-panel__head">
        <div>
          <h2 class="title-m">{item.name}</h2>
          <span class="caption pl-muted">{props.parentName ? `${title} de ${props.parentName}` : title}</span>
        </div>
        <button type="button" class="pl-btn pl-btn--ghost label" onClick={props.onClose}>
          Fermer
        </button>
      </div>
      <form
        class="catalog-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (name.trim() !== '' && name.trim() !== item.name) await props.onUpdate({ name })
        }}
      >
        <label class="pl-field">
          <span class="pl-field__label label">Nom</span>
          <span class="pl-input catalog-text">
            <input type="text" maxLength={200} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </span>
        </label>
        <button type="submit" class="pl-btn label" disabled={props.busy || name.trim() === '' || name.trim() === item.name}>
          Enregistrer le nom
        </button>
      </form>
      {props.sections && props.sectionId !== null && (
        <label class="pl-field">
          <span class="pl-field__label label">Section</span>
          <select
            class="catalog-select"
            disabled={props.busy}
            value={String(props.sectionId)}
            onChange={(e) => void props.onUpdate({ sectionId: Number((e.target as HTMLSelectElement).value) })}
          >
            {props.sections.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
          <span class="caption pl-muted">Seulement une section de même sens (entrée ou sortie) ; l'historique suit.</span>
        </label>
      )}
      {props.parentName && <p class="caption pl-muted">Une sous-catégorie garde sa catégorie « {props.parentName} ».</p>}
      <div class="pl-group">
        <h3 class="title-s">Archivage</h3>
        {blocked ? (
          <p class="caption pl-muted">
            Impossible tant que {count(item.lines, 'ligne')} de budget {item.lines === 1 ? 'est active' : 'sont actives'} ici : archive d'abord{' '}
            {item.lines === 1 ? 'cette ligne' : 'ces lignes'} (dernier mois).
          </p>
        ) : confirming ? (
          <>
            <p class="caption">
              Archiver « {item.name} » ? {props.pick.kind === 'section' ? 'Elle disparaît des choix, avec ses catégories.' : 'Elle disparaît des choix.'}
              {props.subCount > 0 ? ` Ses ${count(props.subCount, 'sous-catégorie')} sont archivées avec elle.` : ''} L'historique reste intact ; on ne désarchive pas dans cette version.
            </p>
            <div class="pl-actions">
              <button
                type="button"
                class="pl-btn pl-btn--primary label"
                disabled={props.busy}
                onClick={async () => {
                  if (await props.onArchive()) props.onClose()
                  else setConfirming(false)
                }}
              >
                Archiver
              </button>
              <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setConfirming(false)}>
                Annuler
              </button>
            </div>
          </>
        ) : (
          <button type="button" class="pl-btn label" disabled={props.busy} onClick={() => setConfirming(true)}>
            Archiver…
          </button>
        )}
      </div>
      {props.message && <p class={`pl-banner${props.message.kind === 'error' ? ' pl-banner--over' : ''}`} role="alert">{props.message.text}</p>}
    </aside>
  )
}

export function CategoriesScreen({ ctx, refresh }: { ctx: MonthContext; refresh: () => Promise<void> }) {
  const tree = catalogView(ctx.app, monthOf(ctx.today))
  const { busy, message, run, clear } = useWriter(refresh)
  const [folded, toggle] = useFoldedSections()
  const [pick, setPick] = useState<Pick | null>(null)
  const [adding, setAdding] = useState<Adding | null>(null)
  const [reorder, setReorder] = useState(false)

  const open = (p: Pick | null) => {
    clear()
    setPick(p)
  }

  // What the panel shows: found again in the data after every reload (gone: the panel closes).
  let selected: { item: CatalogItem; section: CatalogSection; category: CatalogCategory | null } | null = null
  for (const s of tree) {
    if (pick?.kind === 'section' && s.id === pick.id) selected = { item: s, section: s, category: null }
    for (const c of s.categories) {
      if (pick?.kind === 'category' && c.id === pick.id) selected = { item: c, section: s, category: null }
      for (const sub of c.subs) if (pick?.kind === 'category' && sub.id === pick.id) selected = { item: sub, section: s, category: c }
    }
  }

  const post = (path: string, body: unknown) => apiSend('POST', path, body)
  const createSection = (name: string, direction: 'in' | 'out') =>
    run(() => post('/api/sections', { name, direction } satisfies NewSectionRequest))
  const createCategory = (body: NewCategoryRequest) => run(() => post('/api/categories', body))
  const order = (body: OrderRequest) => run(() => post('/api/order', body))
  const move = <T extends CatalogItem>(items: T[], index: number, delta: -1 | 1, make: (list: { id: number; rowVersion: number }[]) => OrderRequest) => {
    const list = items.map((i) => ({ id: i.id, rowVersion: i.rowVersion }))
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const [item] = list.splice(index, 1)
    list.splice(target, 0, item as { id: number; rowVersion: number })
    void order(make(list))
  }

  const empty = tree.length === 0

  return (
    <div class="month">
      <header class="ops-head">
        <div class="month-title">
          <h1 class="title-l">Budget</h1>
          <span class="caption pl-muted">Catégories</span>
        </div>
        <div class="pl-actions">
          <button type="button" class="pl-btn label" aria-pressed={reorder} onClick={() => setReorder(!reorder)}>
            {reorder ? 'Terminer' : 'Réorganiser'}
          </button>
          {!reorder && (
            <button type="button" class="pl-btn pl-btn--primary label" onClick={() => setAdding({ kind: 'section' })}>
              <Icon name="plus" />
              Nouvelle section
            </button>
          )}
        </div>
      </header>
      {message && !selected && <p class={`pl-banner${message.kind === 'error' ? ' pl-banner--over' : ''}`} role="alert">{message.text}</p>}
      <div class="month__body">
        <div class="month-table">
          {adding?.kind === 'section' && (
            <AddRow
              label="Nom de la nouvelle section"
              withDirection
              busy={busy}
              onCreate={async (name, direction) => {
                const ok = await createSection(name, direction)
                if (ok) setAdding(null)
                return ok
              }}
              onCancel={() => setAdding(null)}
            />
          )}
          {empty && <p class="body pl-muted month-empty">Aucune section.</p>}
          <div class="pl-table catalog-list">
            {tree.map((s, si) => {
              const isOpen = !folded.has(s.id)
              return (
                <Fragment key={s.id}>
                  <div class="pl-row pl-row--section catalog-section" aria-current={pick?.kind === 'section' && pick.id === s.id ? 'true' : undefined}>
                    <button type="button" class="pl-row__toggle title-s" aria-expanded={isOpen} onClick={() => toggle(s.id)}>
                      <Icon name="chevron-bas" />
                      {s.name}
                    </button>
                    <span class="caption pl-muted">
                      {sameSense(s.direction)} · {count(s.categories.length, 'catégorie')}
                    </span>
                    {reorder ? (
                      <Arrows name={s.name} first={si === 0} last={si === tree.length - 1} busy={busy} move={(d) => move(tree, si, d, (items) => ({ kind: 'section', items }))} />
                    ) : (
                      <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => open({ kind: 'section', id: s.id })}>
                        Modifier
                      </button>
                    )}
                  </div>
                  {isOpen &&
                    s.categories.map((c, ci) => (
                      <div key={c.id} class="catalog-category">
                        <div class="pl-row table" aria-current={pick?.kind === 'category' && pick.id === c.id ? 'true' : undefined}>
                          <button type="button" class="budget-name" onClick={() => open({ kind: 'category', id: c.id })}>
                            <b>{c.name}</b>
                            <small class="caption pl-muted">{linesText(c.lines)}</small>
                          </button>
                          {reorder ? (
                            <Arrows
                              name={c.name}
                              first={ci === 0}
                              last={ci === s.categories.length - 1}
                              busy={busy}
                              move={(d) => move(s.categories, ci, d, (items) => ({ kind: 'category', group: { sectionId: s.id }, items }))}
                            />
                          ) : (
                            <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setAdding({ kind: 'sub', parentId: c.id })}>
                              + sous-catégorie
                            </button>
                          )}
                        </div>
                        {c.subs.length > 0 && (
                          <ul class="catalog-subs">
                            {c.subs.map((sub, i) => (
                              <li key={sub.id}>
                                <button
                                  type="button"
                                  class="pl-pill catalog-chip"
                                  aria-current={pick?.kind === 'category' && pick.id === sub.id ? 'true' : undefined}
                                  onClick={() => open({ kind: 'category', id: sub.id })}
                                >
                                  {sub.name}
                                </button>
                                {reorder && (
                                  <Arrows
                                    name={sub.name}
                                    first={i === 0}
                                    last={i === c.subs.length - 1}
                                    busy={busy}
                                    move={(d) => move(c.subs, i, d, (items) => ({ kind: 'category', group: { parentId: c.id }, items }))}
                                  />
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {adding?.kind === 'sub' && adding.parentId === c.id && (
                          <AddRow
                            label={`Nom de la sous-catégorie de ${c.name}`}
                            busy={busy}
                            warning={
                              c.subs.length === 0
                                ? `« ${c.name} » ne servira plus à catégoriser : choisis une de ses sous-catégories. Les opérations déjà rangées dans « ${c.name} » restent valides et s'affichent « ${c.name} (sans détail) ».`
                                : null
                            }
                            onCreate={async (name, _d, confirmed) => {
                              const ok = await createCategory({ name, parentId: c.id, ...(confirmed ? { confirmFirstSub: true } : {}) })
                              if (ok) setAdding(null)
                              return ok
                            }}
                            onCancel={() => setAdding(null)}
                          />
                        )}
                      </div>
                    ))}
                  {isOpen && adding?.kind === 'category' && adding.sectionId === s.id && (
                    <AddRow
                      label={`Nom de la catégorie dans ${s.name}`}
                      busy={busy}
                      onCreate={async (name) => {
                        const ok = await createCategory({ name, sectionId: s.id })
                        if (ok) setAdding(null)
                        return ok
                      }}
                      onCancel={() => setAdding(null)}
                    />
                  )}
                  {isOpen && !reorder && !(adding?.kind === 'category' && adding.sectionId === s.id) && (
                    <div class="pl-row table catalog-addcat">
                      <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setAdding({ kind: 'category', sectionId: s.id })}>
                        + Catégorie
                      </button>
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>
        </div>
        {selected && pick && (
          <Panel
            key={`${pick.kind}-${pick.id}`}
            pick={pick}
            item={selected.item}
            sections={
              pick.kind === 'category' && selected.category === null
                ? tree.filter((s) => s.direction === selected.section.direction).map((s) => ({ id: s.id, name: s.name }))
                : null
            }
            sectionId={pick.kind === 'category' && selected.category === null ? selected.section.id : null}
            parentName={selected.category?.name ?? null}
            subCount={pick.kind === 'section' ? selected.section.categories.reduce((n, c) => n + 1 + c.subs.length, 0) : (selected.item as CatalogCategory).subs?.length ?? 0}
            busy={busy}
            message={message}
            onClose={() => open(null)}
            onUpdate={(body) =>
              run(() =>
                apiSend('PATCH', `/api/${pick.kind === 'section' ? 'sections' : 'categories'}/${pick.id}`, {
                  rowVersion: selected.item.rowVersion,
                  ...body,
                } satisfies UpdateRequest),
              )
            }
            onArchive={() =>
              run(() =>
                post(`/api/${pick.kind === 'section' ? 'sections' : 'categories'}/${pick.id}/archive`, {
                  rowVersion: selected.item.rowVersion,
                } satisfies ArchiveRequest),
              )
            }
          />
        )}
      </div>
    </div>
  )
}
