// « Répartir » (spec 3.3): parts (category, amount); each part has a category; the first takes
// what the others leave, until its amount is typed by hand. Opened from Catégoriser and from the
// record of an operation; « Valider » hands the parts back, the screen saves them later.

import { useEffect, useRef, useState } from 'preact/hooks'
import type { PartInput } from '../../../shared/src/engine'
import { signedEuros } from '../format'
import { CategoryField } from './CategoryField'
import { centsText, fillFirst, splitParts, splitStatus, type CategoryChoice, type PartDraft } from './entry'

export function SplitDialog(props: {
  title: string
  amountCents: number
  /** The parts there, or the category chosen so far. */
  initial: PartInput[]
  choices: CategoryChoice[]
  labelOf: (id: number) => string
  onDone: (parts: PartInput[]) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [drafts, setDrafts] = useState<PartDraft[]>(() => {
    const start = props.initial.map((p) => ({ categoryId: p.categoryId, amount: centsText(p.amountCents) }))
    return start.length > 1
      ? start
      : [
          { categoryId: start[0]?.categoryId ?? null, amount: centsText(props.amountCents) },
          { categoryId: null, amount: '' },
        ]
  })
  const [firstByHand, setFirstByHand] = useState(props.initial.length > 1)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const set = (next: PartDraft[], typedFirst = false) => {
    const byHand = firstByHand || typedFirst
    if (typedFirst) setFirstByHand(true)
    setDrafts(byHand ? next : fillFirst(next, props.amountCents))
  }
  const status = splitStatus(drafts, props.amountCents)

  return (
    <dialog ref={ref} class="line-dialog split-dialog" aria-label={`Répartir ${props.title}`} onClose={props.onClose}>
      <form
        class="line-form"
        onSubmit={(e) => {
          e.preventDefault()
          const parts = splitParts(drafts, props.amountCents)
          if (status.ok && parts) props.onDone(parts)
        }}
      >
        <div class="month-panel__head">
          <div>
            <h2 class="title-m">Répartir</h2>
            <span class="caption pl-muted">
              {props.title} · <span class="pl-num">{signedEuros(props.amountCents)}</span>
            </span>
          </div>
          <button type="button" class="pl-btn pl-btn--ghost label" onClick={props.onClose}>
            Fermer
          </button>
        </div>
        <div class="split-rows">
          <div class="split-row label pl-muted">
            <span>Catégorie</span>
            <span>Montant (€)</span>
            <span />
          </div>
          {drafts.map((d, i) => (
            <div key={i} class="split-row">
              <CategoryField
                choices={props.choices}
                value={d.categoryId}
                valueLabel={d.categoryId === null ? undefined : props.labelOf(d.categoryId)}
                label={`Catégorie de la part ${i + 1}`}
                onChange={(id) => set(drafts.map((x, k) => (k === i ? { ...x, categoryId: id } : x)))}
                autoFocus={i === 1 && d.categoryId === null}
              />
              <span class="pl-input split-amount">
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Montant de la part ${i + 1}`}
                  value={d.amount}
                  onInput={(e) =>
                    set(
                      drafts.map((x, k) => (k === i ? { ...x, amount: (e.target as HTMLInputElement).value } : x)),
                      i === 0,
                    )
                  }
                />
                <span>€</span>
              </span>
              {drafts.length > 1 ? (
                <button
                  type="button"
                  class="pl-btn pl-btn--ghost label"
                  aria-label={`Retirer la part ${i + 1}`}
                  onClick={() => set(drafts.filter((_, k) => k !== i))}
                >
                  Retirer
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        <button type="button" class="pl-btn pl-btn--ghost label split-add" onClick={() => set([...drafts, { categoryId: null, amount: '' }])}>
          + Une part
        </button>
        <div class="pl-actions line-dialog__actions">
          <span class={`caption split-status${status.ok ? ' pl-muted' : ' line-removed'}`}>{status.text}</span>
          <button type="submit" class="pl-btn pl-btn--primary label" disabled={!status.ok}>
            Valider
          </button>
        </div>
      </form>
    </dialog>
  )
}
