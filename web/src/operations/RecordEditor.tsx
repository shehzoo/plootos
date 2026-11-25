// The record of an operation on a computer (spec 3.2): category, parts and comment can change; a
// manual entry also its amount and value date, and « Supprimer » archives it. One « Enregistrer »
// for the whole record (DECISIONS.md, 2026-11-25). An imported operation keeps its bank fields.
// A phone shows the record read only (spec 4.2).

import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Operation, PartInput } from '../../../shared/src/engine'
import { apiSend } from '../api'
import { useWriter } from '../budget/write'
import { fullDate, signedEuros } from '../format'
import type { MonthContext } from '../month/view'
import type { OperationDetail } from './view'
import { CategoryField } from './CategoryField'
import { SplitDialog } from './SplitDialog'
import { categoryChoices, categoryLabel, draftCents, recordChange, recordDraft, type RecordDraft } from './entry'

export function RecordEditor(props: {
  ctx: MonthContext
  operation: Operation
  rowVersion: number
  view: OperationDetail
  refresh: () => Promise<void>
  /** After « Supprimer »: the record closes. */
  onDeleted: () => void
}) {
  const { ctx, operation: o, view } = props
  const choices = useMemo(() => categoryChoices(ctx), [ctx])
  const [draft, setDraft] = useState<RecordDraft>(() => recordDraft(ctx, o))
  const [splitting, setSplitting] = useState(false)
  const [confirm, setConfirm] = useState<'duplicate' | 'delete' | null>(null)
  const { busy, message, run } = useWriter(props.refresh)
  // Saved: the record shows what is stored, once reloaded. Refused (« Modifié entre-temps »):
  // what was typed stays, to send again on the new version.
  const [saves, setSaves] = useState(0)
  useEffect(() => {
    if (saves > 0) setDraft(recordDraft(ctx, o))
  }, [saves])
  const manual = o.origin === 'manual'
  const change = recordChange(ctx, o, draft)
  const cents = draftCents(draft, o)
  const labelOf = (id: number) => categoryLabel(ctx, id)
  const edit = (patch: Partial<RecordDraft>) => {
    setConfirm(null)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const setParts = (parts: PartInput[]) => edit({ parts, suggested: false })

  const save = async () => {
    if (!change.changed || change.error) return
    if (change.duplicate && confirm !== 'duplicate') {
      setConfirm('duplicate')
      return
    }
    const ok = await run(() =>
      apiSend('PATCH', `/api/operations/${o.id}`, {
        rowVersion: props.rowVersion,
        ...change.body,
        confirmDuplicate: change.duplicate ? true : undefined,
      }),
    )
    if (ok) setSaves((n) => n + 1)
    setConfirm(null)
  }

  const remove = async () => {
    if (confirm !== 'delete') {
      setConfirm('delete')
      return
    }
    const ok = await run(() =>
      apiSend('POST', `/api/operations/${o.id}/delete`, {
        rowVersion: props.rowVersion,
      }),
    )
    setConfirm(null)
    if (ok) props.onDeleted()
  }

  const parts = change.parts
  const single = parts.length === 1 ? parts[0] : undefined
  return (
    <>
      <form
        class="line-form record-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {manual ? (
          <div class="record-fields">
            <label class="label entry-label">
              Montant
              <span class={`pl-input${cents !== null && cents > 0 ? ' entry-in' : ''}`}>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Montant"
                  value={draft.amount}
                  onInput={(e) => edit({ amount: (e.target as HTMLInputElement).value })}
                />
                <span>€</span>
              </span>
              <span class="caption pl-muted">{cents === null ? '' : cents > 0 ? 'Entrée' : 'Sortie'} · « + » ou « - » pour changer de sens</span>
            </label>
            <label class="label entry-label">
              Date de valeur
              <span class="pl-input entry-date">
                <input
                  type="date"
                  aria-label="Date de valeur"
                  value={draft.valueDate}
                  onInput={(e) => edit({ valueDate: (e.target as HTMLInputElement).value })}
                />
              </span>
            </label>
          </div>
        ) : (
          <div>
            <b class="amount-l">{signedEuros(o.amountCents)}</b>
            <span class="caption pl-muted ops-record__sub">{fullDate(o.valueDate)}</span>
          </div>
        )}

        <div class="pl-group">
          <h3 class="title-s">{single ? 'Catégorie' : 'Répartition'}</h3>
          {single ? (
            <CategoryField
              choices={choices}
              value={single.categoryId}
              valueLabel={single.categoryId === null ? undefined : labelOf(single.categoryId)}
              suggested={draft.suggested}
              label="Catégorie"
              placeholder="À catégoriser"
              onChange={(id) => setParts([{ categoryId: id, amountCents: single.amountCents }])}
            />
          ) : (
            parts.map((p, i) => (
              <div key={i} class="pl-op table">
                <span>{p.categoryId === null ? 'À catégoriser' : labelOf(p.categoryId)}</span>
                <span class="pl-num">{signedEuros(p.amountCents)}</span>
              </div>
            ))
          )}
          <button type="button" class="pl-btn pl-btn--ghost label detail-action" disabled={cents === null} onClick={() => setSplitting(true)}>
            {single ? 'Répartir' : 'Modifier la répartition'}
          </button>
          {view.categorizedBy && <p class="caption pl-muted detail-note">Catégorisée par {view.categorizedBy}</p>}
        </div>

        <label class="label entry-label">
          Commentaire
          <span class="pl-input catalog-text">
            <input
              type="text"
              maxLength={500}
              placeholder="Facultatif"
              aria-label="Commentaire"
              value={draft.comment}
              onInput={(e) => edit({ comment: (e.target as HTMLInputElement).value })}
            />
          </span>
        </label>

        {view.bankLabel && (
          <div class="pl-group">
            <h3 class="title-s">Libellé de la banque</h3>
            <p class="body detail-note ops-record__bank">{view.bankLabel}</p>
          </div>
        )}

        {change.error && <p class="caption detail-note line-removed">{change.error}</p>}
        {message && (
          <p class={`caption detail-note${message.kind === 'error' ? ' line-removed' : ''}`} role="alert">
            {message.text}
          </p>
        )}
        {confirm === 'duplicate' && change.duplicate && (
          <div class="line-confirm">
            <p class="body">{change.duplicate} Enregistrer quand même ?</p>
          </div>
        )}
        {confirm === 'delete' && (
          <div class="line-confirm">
            <p class="body">Supprimer cet ajout manuel ? Il sort de tous les calculs et ne revient pas.</p>
          </div>
        )}
        <div class="pl-actions record-actions">
          {manual && (
            <button type="button" class={`pl-btn label${confirm === 'delete' ? ' record-delete--confirm' : ''}`} disabled={busy} onClick={remove}>
              {confirm === 'delete' ? 'Oui, supprimer' : 'Supprimer'}
            </button>
          )}
          {confirm !== null && (
            <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setConfirm(null)}>
              Annuler
            </button>
          )}
          <button type="submit" class="pl-btn pl-btn--primary label" disabled={busy || !change.changed || !!change.error || confirm === 'delete'}>
            {confirm === 'duplicate' ? 'Enregistrer quand même' : 'Enregistrer'}
          </button>
        </div>
        <p class="caption pl-muted detail-note">
          {view.origin.manual ? 'Saisie' : 'Importée'} par {view.origin.by}
          {view.origin.on ? ` le ${fullDate(view.origin.on)}` : ''}
        </p>
      </form>
      {splitting && cents !== null && (
        <SplitDialog
          title={view.title}
          amountCents={cents}
          initial={parts}
          choices={choices}
          labelOf={labelOf}
          onClose={() => setSplitting(false)}
          onDone={(next) => {
            setSplitting(false)
            setParts(next)
          }}
        />
      )}
    </>
  )
}
