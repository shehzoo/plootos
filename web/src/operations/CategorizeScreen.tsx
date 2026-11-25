// Screen 3.3, Catégoriser (computer): every operation to categorize, whatever its month, grouped by
// month of value date. The category field finds a category in a few letters, Enter goes to the
// next operation, a suggestion (R11) shows in italics and is saved unless changed. Checked
// operations go at once in a category (« Mettre dans… »); « Enregistrer N opérations » saves the
// others that have a category, all or nothing. What is typed stays on screen through a reload,
// so that a refusal (« Modifié entre-temps ») loses nothing.

import { useMemo, useState } from 'preact/hooks'
import type { CategorizeItem } from '../../../shared/src/api'
import type { Id, PartInput } from '../../../shared/src/engine'
import { apiSend } from '../api'
import { useWriter } from '../budget/write'
import { count, monthTitle, shortDate, signedEuros } from '../format'
import { Icon } from '../icons'
import type { MonthContext } from '../month/view'
import { back, navigate, operationsPath } from '../router'
import { CategoryField } from './CategoryField'
import { SplitDialog } from './SplitDialog'
import { categoryChoices, categoryLabel, todoGroups, type TodoRow } from './entry'

interface Draft {
  categoryId: Id | null
  /** The category is the suggestion (R11), not changed. */
  suggested: boolean
  /** Split in « Répartir »: replaces the category. */
  parts: PartInput[] | null
  comment: string
}

const draftOf = (row: TodoRow): Draft => ({ categoryId: row.suggestion, suggested: row.suggestion !== null, parts: null, comment: row.comment ?? '' })

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one)

export function CategorizeScreen({ ctx, narrow, refresh }: { ctx: MonthContext; narrow: boolean; refresh: () => Promise<void> }) {
  const groups = todoGroups(ctx)
  const rows = groups.flatMap((g) => g.rows)
  const choices = useMemo(() => categoryChoices(ctx), [ctx])
  const [drafts, setDrafts] = useState<Map<Id, Draft>>(() => new Map())
  const [checked, setChecked] = useState<Set<Id>>(() => new Set())
  const [splitting, setSplitting] = useState<Id | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const { busy, message, run } = useWriter(refresh)
  const labelOf = (id: number) => categoryLabel(ctx, id)

  if (narrow) {
    return (
      <div class="detail-page">
        <header class="detail-page__head">
          <button type="button" class="pl-iconbtn" aria-label="Retour" onClick={() => back(operationsPath(null, null))}>
            <Icon name="chevron-gauche" />
          </button>
          <div>
            <h1 class="title-m">Catégoriser</h1>
          </div>
        </header>
        <p class="body pl-muted month-empty">La catégorisation se fait sur ordinateur.</p>
      </div>
    )
  }

  const draft = (row: TodoRow) => drafts.get(row.id) ?? draftOf(row)
  const setDraft = (row: TodoRow, patch: Partial<Draft>) => {
    setDone(null)
    setDrafts((prev) => new Map(prev).set(row.id, { ...(prev.get(row.id) ?? draftOf(row)), ...patch }))
  }
  const checkedRows = rows.filter((r) => checked.has(r.id))
  const ready = rows.filter((r) => {
    const d = draft(r)
    return d.parts !== null || d.categoryId !== null
  })

  const itemOf = (row: TodoRow, parts: PartInput[], withComment: boolean): CategorizeItem => {
    const d = draft(row)
    const comment = d.comment.trim() === '' ? null : d.comment.trim()
    return { id: row.id, rowVersion: row.rowVersion, parts, ...(withComment && comment !== row.comment ? { comment } : {}) }
  }

  /** Sends, then forgets the drafts of what was saved; on a conflict, marks the rows changed meanwhile. */
  const send = async (items: CategorizeItem[], doneText: string) => {
    const ok = await run(() => apiSend('POST', '/api/operations/categorize', { items }))
    if (ok) {
      const ids = new Set(items.map((i) => i.id))
      setDrafts((prev) => new Map([...prev].filter(([id]) => !ids.has(id))))
      setChecked((prev) => new Set([...prev].filter((id) => !ids.has(id))))
      setDone(doneText)
    }
  }
  const conflictIds = new Set((message?.changed ?? []).filter((c) => c.table === 'operation').map((c) => c.id))

  const putIn = (categoryId: Id | null) => {
    if (categoryId === null || checkedRows.length === 0) return
    const n = checkedRows.length
    void send(
      checkedRows.map((r) => itemOf(r, [{ categoryId, amountCents: r.amountCents }], true)),
      `${count(n, 'opération')} ${plural(n, 'enregistrée', 'enregistrées')} dans ${labelOf(categoryId)}.`,
    )
  }

  const saveAll = () => {
    const items = ready.map((r) => {
      const d = draft(r)
      return itemOf(r, d.parts ?? [{ categoryId: d.categoryId, amountCents: r.amountCents }], true)
    })
    if (items.length === 0) return
    void send(items, `${count(items.length, 'opération')} ${plural(items.length, 'catégorisée', 'catégorisées')}.`)
  }

  const focusNext = (id: Id) => {
    const i = rows.findIndex((r) => r.id === id)
    const next = rows.slice(i + 1).find((r) => draft(r).parts === null)
    const el = next
      ? document.querySelector<HTMLInputElement>(`[data-catfield="op-${next.id}"] input`)
      : document.querySelector<HTMLButtonElement>('.todo-save')
    el?.focus()
  }

  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id))
  const splitRow = splitting === null ? undefined : rows.find((r) => r.id === splitting)

  return (
    <div class="month todo">
      <header class="ops-head todo-head">
        <div class="month-title">
          <button type="button" class="pl-btn pl-btn--ghost label todo-back" onClick={() => back(operationsPath(null, null))}>
            <Icon name="chevron-gauche" />
            Opérations
          </button>
          <h1 class="title-l">Catégoriser</h1>
          <span class="caption pl-muted">{rows.length === 0 ? 'Tout est catégorisé' : `${count(rows.length, 'opération')} à catégoriser`}</span>
        </div>
      </header>

      {message && (
        <p class={`body detail-note${message.kind === 'error' ? ' line-removed' : ''}`} role="alert">
          {message.text}
          {conflictIds.size > 0 && ' Les opérations concernées sont signalées ; ce que tu as tapé est gardé.'}
        </p>
      )}
      {done && !message && (
        <p class="body pl-muted detail-note" role="status">
          {done}
        </p>
      )}

      {rows.length === 0 ? (
        <p class="body pl-muted month-empty">
          Toutes les opérations sont catégorisées.{' '}
          <button type="button" class="detail-link" onClick={() => navigate('/')}>
            Voir le mois en cours
          </button>
        </p>
      ) : (
        <>
          {checkedRows.length > 0 && (
            <div class="todo-bulk" role="group" aria-label="Opérations sélectionnées">
              <b class="body">
                {checkedRows.length} {plural(checkedRows.length, 'sélectionnée', 'sélectionnées')}
              </b>
              <CategoryField
                choices={choices}
                value={null}
                action
                label="Mettre les opérations sélectionnées dans une catégorie"
                placeholder="Mettre dans… (taper pour chercher)"
                onChange={putIn}
              />
              <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setChecked(new Set())}>
                Annuler la sélection
              </button>
            </div>
          )}
          <div class="pl-table todo-table">
            <div class="pl-row pl-row--head label">
              <span>
                <input
                  type="checkbox"
                  class="todo-check"
                  aria-label="Tout sélectionner"
                  checked={allChecked}
                  onChange={(e) => setChecked((e.target as HTMLInputElement).checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </span>
              <span>Date</span>
              <span>Libellé de la banque</span>
              <span class="pl-num">Montant</span>
              <span>Catégorie</span>
              <span>Commentaire</span>
              <span />
            </div>
            {groups.map((g) => (
              <div key={g.month} role="rowgroup">
                <div class="pl-row pl-row--section todo-month">
                  <span class="title-s">{monthTitle(g.month)}</span>
                </div>
                {g.rows.map((r) => {
                  const d = draft(r)
                  return (
                    <div key={r.id} class={`pl-row table todo-row${checked.has(r.id) ? ' todo-row--checked' : ''}`}>
                      <span>
                        <input
                          type="checkbox"
                          class="todo-check"
                          aria-label={`Sélectionner ${r.label}, ${signedEuros(r.amountCents)}`}
                          checked={checked.has(r.id)}
                          onChange={(e) =>
                            setChecked((prev) => {
                              const next = new Set(prev)
                              if ((e.target as HTMLInputElement).checked) next.add(r.id)
                              else next.delete(r.id)
                              return next
                            })
                          }
                        />
                      </span>
                      <span class="pl-muted">{shortDate(r.valueDate)}</span>
                      <span class="op-label">
                        <span class="op-label__line" title={r.label}>
                          {r.label}
                        </span>
                        {conflictIds.has(r.id) && <span class="pl-pill pl-pill--warn">Modifié entre-temps</span>}
                      </span>
                      <span class="pl-num">{signedEuros(r.amountCents)}</span>
                      {d.parts ? (
                        <span class="caption todo-split">
                          Répartie : {d.parts.map((p) => `${p.categoryId === null ? '?' : labelOf(p.categoryId)} ${signedEuros(p.amountCents)}`).join(' · ')}
                        </span>
                      ) : (
                        <CategoryField
                          name={`op-${r.id}`}
                          choices={choices}
                          value={d.categoryId}
                          suggested={d.suggested}
                          label={`Catégorie de ${r.label}, ${signedEuros(r.amountCents)}`}
                          onChange={(id) => setDraft(r, { categoryId: id, suggested: false })}
                          onEnter={() => focusNext(r.id)}
                        />
                      )}
                      <span class="pl-input catalog-text">
                        <input
                          type="text"
                          maxLength={500}
                          placeholder="Facultatif"
                          aria-label={`Commentaire de ${r.label}`}
                          value={d.comment}
                          onInput={(e) => setDraft(r, { comment: (e.target as HTMLInputElement).value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              focusNext(r.id)
                            }
                          }}
                        />
                      </span>
                      <span>
                        <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setSplitting(r.id)}>
                          {d.parts ? 'Modifier' : 'Répartir'}
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {checkedRows.length === 0 && (
            <div class="pl-actions todo-foot">
              <button type="button" class="pl-btn pl-btn--primary label todo-save" disabled={busy || ready.length === 0} onClick={saveAll}>
                {ready.length === 0 ? 'Enregistrer' : `Enregistrer ${count(ready.length, 'opération')}`}
              </button>
            </div>
          )}
        </>
      )}

      {splitRow && (
        <SplitDialog
          title={splitRow.label}
          amountCents={splitRow.amountCents}
          initial={draft(splitRow).parts ?? [{ categoryId: draft(splitRow).categoryId, amountCents: splitRow.amountCents }]}
          choices={choices}
          labelOf={labelOf}
          onClose={() => setSplitting(null)}
          onDone={(parts) => {
            setSplitting(null)
            const only = parts.length === 1 ? parts[0] : undefined
            setDraft(splitRow, only ? { parts: null, categoryId: only.categoryId, suggested: false } : { parts, suggested: false })
          }}
        />
      )}
    </div>
  )
}
