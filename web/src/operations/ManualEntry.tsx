// « + Ajout manuel » (spec 3.2): several operations at once, all or nothing. On a computer, a
// window with one row per operation: amount (money out unless « + »), value date, category,
// comment; Enter goes to the next row; an empty row is added, with the same date. On a phone,
// a full screen with one card per operation and a Sortie / Entrée switch. R5: a duplicate is
// shown under its row, and « Enregistrer » asks once more before sending it.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { MAX_NEW_OPERATIONS, type NewOperationItem } from '../../../shared/src/api'
import { apiSend } from '../api'
import { useWriter } from '../budget/write'
import { lastManualDate } from '../../../shared/src/engine'
import { Icon } from '../icons'
import type { MonthContext } from '../month/view'
import { CategoryField } from './CategoryField'
import { categoryChoices, categoryLabel, checkRows, emptyRow, isFilled, readyRows, totalText, type EntryRow } from './entry'

/** Today, unless the app was set up today (R6): the date is then left to fill. */
const firstDate = (today: string, opening: string) => (today > opening ? today : '')

export function ManualEntry(props: { ctx: MonthContext; narrow: boolean; refresh: () => Promise<void>; onClose: () => void }) {
  const { ctx, narrow } = props
  const opening = ctx.ledger.data.openingBalance.balanceDate
  const [rows, setRows] = useState<EntryRow[]>(() => [emptyRow(firstDate(ctx.today, opening))])
  const [confirming, setConfirming] = useState(false)
  const { busy, message, run } = useWriter(props.refresh)
  const choices = useMemo(() => categoryChoices(ctx), [ctx])
  const checks = checkRows(ctx, rows, narrow)
  const ready = readyRows(rows, checks)
  const duplicates = rows.filter((r, i) => isFilled(r) && checks[i]?.duplicate).length
  const tooMany = ready.count > MAX_NEW_OPERATIONS
  const dialog = useRef<HTMLDialogElement>(null)
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])

  /** A change to a row; an empty row is added once the last one is filled, with its date. */
  const change = (i: number, patch: Partial<EntryRow>) => {
    setConfirming(false)
    setRows((prev) => {
      const next = prev.map((r, k) => (k === i ? { ...r, ...patch } : r))
      const last = next[next.length - 1]
      if (last && isFilled(last)) next.push(emptyRow(last.valueDate))
      return next
    })
  }

  const focusRow = (i: number) => {
    const el = form.current?.querySelector<HTMLInputElement>(`[data-row="${i}"] [data-k="amount"]`)
    el?.focus()
  }

  const save = async () => {
    if (ready.blocked || ready.count === 0 || tooMany) return
    if (duplicates > 0 && !confirming) {
      setConfirming(true)
      return
    }
    const items: NewOperationItem[] = []
    rows.forEach((r, i) => {
      const c = checks[i]
      if (!isFilled(r) || !c || c.cents === null) return
      items.push({
        valueDate: r.valueDate,
        amountCents: c.cents,
        categoryId: r.categoryId,
        comment: r.comment.trim() === '' ? null : r.comment.trim(),
        confirmDuplicate: c.duplicate !== null ? true : undefined,
      })
    })
    const ok = await run(() => apiSend('POST', '/api/operations', { items }))
    setConfirming(false)
    if (ok) props.onClose()
  }

  const footer = (
    <div class="entry-foot">
      {message && (
        <p class={`caption detail-note${message.kind === 'error' ? ' line-removed' : ''}`} role="alert">
          {message.text}
        </p>
      )}
      {tooMany && <p class="caption detail-note line-removed">{MAX_NEW_OPERATIONS} opérations au plus par envoi.</p>}
      {confirming ? (
        <div class="line-confirm">
          <p class="body">
            {duplicates > 1 ? `${duplicates} opérations ressemblent à des doublons` : 'Une opération ressemble à un doublon'} (même montant, même date de
            valeur). Les enregistrer quand même ?
          </p>
          <div class="pl-actions line-dialog__actions">
            <button type="button" class="pl-btn label" onClick={() => setConfirming(false)}>
              Revenir
            </button>
            <button type="button" class="pl-btn pl-btn--primary label" disabled={busy} onClick={save}>
              Enregistrer quand même
            </button>
          </div>
        </div>
      ) : (
        <div class="pl-actions line-dialog__actions">
          <span class="caption pl-muted entry-total pl-num">{totalText(ready.count, ready.totalCents)}</span>
          <button type="submit" class="pl-btn pl-btn--primary label" disabled={busy || ready.blocked || ready.count === 0 || tooMany}>
            {ready.count > 1 ? `Enregistrer les ${ready.count}` : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  )

  const dateField = (r: EntryRow, i: number, label: string) => (
    <span class="pl-input entry-date">
      <input
        type="date"
        data-k="date"
        aria-label={label}
        max={lastManualDate(ctx.today)}
        value={r.valueDate}
        onInput={(e) => change(i, { valueDate: (e.target as HTMLInputElement).value })}
        onKeyDown={(e) => {
          if (narrow || e.key !== 'Enter') return
          e.preventDefault()
          focusRow(i + 1)
        }}
      />
    </span>
  )

  const notes = (i: number) => {
    const c = checks[i]
    const r = rows[i]
    if (!c || !r || !isFilled(r)) return null
    return (
      <>
        {c.error && <span class="caption line-removed entry-note">{c.error}</span>}
        {c.duplicate && (
          <span class="caption entry-note entry-dup" role="status">
            {c.duplicate}
          </span>
        )}
      </>
    )
  }

  const onSubmit = (e: Event) => {
    e.preventDefault()
    void save()
  }

  if (narrow) {
    return (
      <div class="detail-page entry-page">
        <header class="detail-page__head">
          <button type="button" class="pl-iconbtn" aria-label="Retour" onClick={props.onClose}>
            <Icon name="chevron-gauche" />
          </button>
          <div>
            <h1 class="title-m">Ajout manuel</h1>
            <span class="caption pl-muted">Une carte par opération</span>
          </div>
        </header>
        <form ref={form} class="entry-cards" onSubmit={onSubmit}>
          {rows.map((r, i) => (
            <div key={i} class="pl-panel entry-card" data-row={i}>
              <div class="entry-card__top">
                <b class="title-s">Opération {i + 1}</b>
                <div class="pl-seg" role="group" aria-label={`Sens de l'opération ${i + 1}`}>
                  <button type="button" aria-pressed={r.direction === 'out'} onClick={() => change(i, { direction: 'out' })}>
                    Sortie
                  </button>
                  <button type="button" aria-pressed={r.direction === 'in'} onClick={() => change(i, { direction: 'in' })}>
                    Entrée
                  </button>
                </div>
              </div>
              <label class="label entry-label">
                Montant
                <span class="pl-input">
                  <input
                    type="text"
                    inputMode="decimal"
                    data-k="amount"
                    aria-label={`Montant de l'opération ${i + 1}`}
                    value={r.amount}
                    onInput={(e) =>
                      change(i, {
                        amount: (e.target as HTMLInputElement).value,
                      })
                    }
                  />
                  <span>€</span>
                </span>
              </label>
              <label class="label entry-label">
                Date de valeur
                {dateField(r, i, `Date de valeur de l'opération ${i + 1}`)}
              </label>
              <div class="label entry-label">
                Catégorie (facultatif)
                <CategoryField
                  choices={choices}
                  value={r.categoryId}
                  label={`Catégorie de l'opération ${i + 1}`}
                  placeholder="À catégoriser"
                  onChange={(id) => change(i, { categoryId: id })}
                />
              </div>
              <label class="label entry-label">
                Commentaire (facultatif)
                <span class="pl-input catalog-text">
                  <input
                    type="text"
                    maxLength={500}
                    aria-label={`Commentaire de l'opération ${i + 1}`}
                    value={r.comment}
                    onInput={(e) =>
                      change(i, {
                        comment: (e.target as HTMLInputElement).value,
                      })
                    }
                  />
                </span>
              </label>
              {notes(i)}
            </div>
          ))}
          <div class="entry-page__foot">{footer}</div>
        </form>
      </div>
    )
  }

  return (
    <dialog ref={dialog} class="line-dialog entry-dialog" aria-label="Ajout manuel" onClose={props.onClose}>
      <form ref={form} class="line-form" onSubmit={onSubmit}>
        <div class="month-panel__head">
          <h2 class="title-m">Ajout manuel</h2>
          <button type="button" class="pl-btn pl-btn--ghost label" onClick={props.onClose}>
            Fermer
          </button>
        </div>
        <div class="entry-rows">
          <div class="entry-row label pl-muted">
            <span>Montant</span>
            <span>Date de valeur</span>
            <span>Catégorie</span>
            <span>Commentaire</span>
          </div>
          {rows.map((r, i) => {
            const cents = checks[i]?.cents ?? null
            const enter = (e: KeyboardEvent) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              focusRow(i + 1)
            }
            return (
              <div key={i} class="entry-row-wrap" data-row={i}>
                <div class="entry-row">
                  <span class={`pl-input${cents !== null && cents > 0 ? ' entry-in' : ''}`}>
                    <input
                      type="text"
                      inputMode="decimal"
                      data-k="amount"
                      autoFocus={i === 0}
                      placeholder={i === 0 ? '42,50' : ''}
                      aria-label={`Montant, ligne ${i + 1}`}
                      value={r.amount}
                      onInput={(e) =>
                        change(i, {
                          amount: (e.target as HTMLInputElement).value,
                        })
                      }
                      onKeyDown={enter}
                    />
                    <span>€</span>
                  </span>
                  {dateField(r, i, `Date de valeur, ligne ${i + 1}`)}
                  <CategoryField
                    choices={choices}
                    value={r.categoryId}
                    valueLabel={r.categoryId === null ? undefined : categoryLabel(ctx, r.categoryId)}
                    label={`Catégorie, ligne ${i + 1}`}
                    placeholder="À catégoriser"
                    onChange={(id) => change(i, { categoryId: id })}
                    onEnter={() => focusRow(i + 1)}
                  />
                  <span class="pl-input catalog-text">
                    <input
                      type="text"
                      maxLength={500}
                      placeholder={i === 0 ? 'Facultatif' : ''}
                      aria-label={`Commentaire, ligne ${i + 1}`}
                      value={r.comment}
                      onInput={(e) =>
                        change(i, {
                          comment: (e.target as HTMLInputElement).value,
                        })
                      }
                      onKeyDown={enter}
                    />
                  </span>
                </div>
                {notes(i)}
              </div>
            )
          })}
        </div>
        <p class="caption pl-muted detail-note">Sortie par défaut, « + » devant le montant pour une entrée. Entrée passe à la ligne suivante.</p>
        {footer}
      </form>
    </dialog>
  )
}
