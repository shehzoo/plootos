// Writing budget lines on a computer (spec 3.6, lot 8): the panel of a new line, the panel of a
// line (one « Enregistrer »; a change of amount, category or rhythm asks « à partir de » and shows
// the months and overrides, R3; archiving asks the last month, R4), and the small window of an
// override. A phone only reads (spec 3.0). Every write goes through `useWriter`: the data are
// reloaded after it, and « Modifié entre-temps » keeps what was typed.

import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ArchiveLineRequest, OverrideRequest, RemoveOverrideRequest, UpdateLineRequest } from '../../../shared/src/api'
import type { Id, Month } from '../../../shared/src/engine'
import { apiSend } from '../api'
import { euros, MONTH_NAMES, parseEuros } from '../format'
import type { MonthContext } from '../month/view'
import {
  anchorChoices,
  categoryChoices,
  changeRequest,
  defaultLastMonth,
  draftOf,
  draftState,
  dueMonthsText,
  editableLine,
  emptyDraft,
  fromChoices,
  lastMonthChoices,
  monthLabel,
  newLineRequest,
  newLineState,
  overrideNoteText,
  previewArchive,
  previewChange,
  sentence,
  startChoices,
  type EditableLine,
  type LineDraft,
  type OverrideTarget,
} from './lines'
import { SHORT_MONTHS } from './view'
import { useWriter, type Message } from './write'

function MessageLine({ message }: { message: Message | null }) {
  if (!message) return null
  return (
    <p class={`pl-banner${message.kind === 'error' ? ' pl-banner--over' : ''}`} role="alert">
      {message.text}
    </p>
  )
}

function MonthSelect(props: { label: string; value: Month; months: Month[]; onChange: (m: Month) => void; inline?: boolean }) {
  const select = (
    <select class="catalog-select line-select" aria-label={props.inline ? props.label : undefined} value={props.value} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}>
      {props.months.map((m) => (
        <option key={m} value={m}>
          {monthLabel(m)}
        </option>
      ))}
    </select>
  )
  if (props.inline) return select
  return (
    <label class="pl-field">
      <span class="pl-field__label label">{props.label}</span>
      {select}
    </label>
  )
}

/** Name, category, amount and rhythm: the fields shared by a new line and a line. */
function Fields(props: {
  ctx: MonthContext
  draft: LineDraft
  set: (d: LineDraft) => void
  /** A line being changed: its due months for « tous les N mois » can be picked (calage). */
  line?: EditableLine
}) {
  const { draft: d, set } = props
  const groups = categoryChoices(props.ctx)
  const everyN = Number(d.everyN)
  const anchors = props.line && d.kind === 'every_n' && Number.isInteger(everyN) && everyN > 1 && everyN <= 24 ? anchorChoices(props.line, everyN) : null
  return (
    <>
      <label class="pl-field">
        <span class="pl-field__label label">Nom</span>
        <span class="pl-input catalog-text">
          <input type="text" maxLength={200} value={d.label} placeholder="Ex. Cantine" onInput={(e) => set({ ...d, label: (e.target as HTMLInputElement).value })} />
        </span>
      </label>
      <label class="pl-field">
        <span class="pl-field__label label">Catégorie</span>
        <select
          class="catalog-select"
          value={d.categoryId === null ? '' : String(d.categoryId)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            set({ ...d, categoryId: v === '' ? null : Number(v) })
          }}
        >
          <option value="">Choisir…</option>
          {groups.map((g) => (
            <optgroup key={g.section} label={g.section}>
              {g.items.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label class="pl-field">
        <span class="pl-field__label label">Montant</span>
        <span class="pl-input">
          <input type="text" inputMode="decimal" value={d.amount} onInput={(e) => set({ ...d, amount: (e.target as HTMLInputElement).value })} />
          <span>€</span>
        </span>
      </label>
      <div class="pl-field">
        <span class="pl-field__label label">Quels mois ?</span>
        <div class="pl-seg" role="group" aria-label="Rythme">
          <button type="button" aria-pressed={d.kind === 'every_n'} onClick={() => set({ ...d, kind: 'every_n', anchor: null })}>
            Tous les N mois
          </button>
          <button type="button" aria-pressed={d.kind === 'months'} onClick={() => set({ ...d, kind: 'months', anchor: null })}>
            Mois cochés
          </button>
        </div>
        {d.kind === 'every_n' ? (
          <span class="line-rhythm body">
            Tous les
            <span class="pl-input line-n">
              <input type="text" inputMode="numeric" aria-label="N" value={d.everyN} onInput={(e) => set({ ...d, everyN: (e.target as HTMLInputElement).value, anchor: null })} />
            </span>
            mois
          </span>
        ) : (
          <span class="line-months" role="group" aria-label="Mois cochés">
            {MONTH_NAMES.map((name, i) => {
              const on = d.months.includes(i + 1)
              return (
                <button
                  key={name}
                  type="button"
                  class="pl-btn label line-month"
                  aria-pressed={on}
                  onClick={() => set({ ...d, months: on ? d.months.filter((m) => m !== i + 1) : [...d.months, i + 1] })}
                >
                  {SHORT_MONTHS[i]}
                </button>
              )
            })}
          </span>
        )}
        {anchors && (
          <label class="pl-field line-anchor">
            <span class="pl-field__label label">Échéances (calage)</span>
            <select
              class="catalog-select line-select"
              value={d.anchor ?? anchors.kept}
              onChange={(e) => {
                const m = (e.target as HTMLSelectElement).value
                set({ ...d, anchor: m === anchors.kept ? null : m })
              }}
            >
              {anchors.months.map((m) => (
                <option key={m} value={m}>
                  {dueMonthsText(m, everyN)}
                </option>
              ))}
            </select>
          </label>
        )}
        {!props.line && d.kind === 'every_n' && everyN > 1 && <span class="caption pl-muted">Calé sur le mois de début.</span>}
      </div>
    </>
  )
}

function PanelHead({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <div class="month-panel__head">
      <div>
        <h2 class="title-m">{title}</h2>
        <span class="caption pl-muted">{sub}</span>
      </div>
      <button type="button" class="pl-btn pl-btn--ghost label" onClick={onClose}>
        Fermer
      </button>
    </div>
  )
}

/** « + Nouvelle ligne »: the months obtained are shown under the form, then « Créer la ligne ». */
export function NewLinePanel(props: { ctx: MonthContext; categoryId: Id | null; refresh: () => Promise<void>; onClose: () => void; onCreated: (id: Id) => void }) {
  const choices = startChoices(props.ctx)
  const [draft, setDraft] = useState<LineDraft>(() => emptyDraft(props.categoryId))
  const [start, setStart] = useState<Month>(choices[0] as Month)
  const { busy, message, run } = useWriter(props.refresh)
  const state = newLineState(draft, start)
  const create = async (e: Event) => {
    e.preventDefault()
    if (state.invalid) return
    let id: Id | null = null
    const ok = await run(async () => {
      const res = await apiSend('POST', '/api/budget-lines', newLineRequest(draft, start))
      id = res.ids[0] ?? null
    })
    if (ok && id !== null) props.onCreated(id)
  }
  return (
    <aside class="pl-panel month-panel" aria-label="Nouvelle ligne de budget">
      <PanelHead title="Nouvelle ligne" sub="Ligne de budget" onClose={props.onClose} />
      <form class="line-form" onSubmit={create}>
        <Fields ctx={props.ctx} draft={draft} set={setDraft} />
        <MonthSelect label="Début" value={start} months={choices} onChange={setStart} />
        {state.months && <p class="caption">Mois concernés : {sentence(state.months)}</p>}
        {state.invalid && draft.label !== '' && <p class="caption pl-muted">{state.invalid}</p>}
        <div class="pl-actions">
          <button type="submit" class="pl-btn pl-btn--primary label" disabled={busy || state.invalid !== null}>
            Créer la ligne
          </button>
        </div>
      </form>
      <MessageLine message={message} />
    </aside>
  )
}

/** The panel of a line: its fields, the confirmation of R3, archiving (R4), then its history. */
export function LinePanel(props: { ctx: MonthContext; lineId: Id; sub: string; refresh: () => Promise<void>; onClose: () => void; children: ComponentChildren }) {
  const line = editableLine(props.ctx, props.lineId)
  if (!line) return null
  return (
    <aside class="pl-panel month-panel" aria-label={`Ligne : ${line.label}`}>
      <PanelHead title={line.label} sub={props.sub} onClose={props.onClose} />
      {line.editable ? (
        <LineForm key={line.id} ctx={props.ctx} line={line} refresh={props.refresh} />
      ) : (
        <p class="caption pl-muted">Ligne archivée : elle ne compte plus, elle reste dans l'historique.</p>
      )}
      {props.children}
    </aside>
  )
}

function LineForm({ ctx, line, refresh }: { ctx: MonthContext; line: EditableLine; refresh: () => Promise<void> }) {
  const [draft, setDraft] = useState<LineDraft>(() => draftOf(line))
  const [confirming, setConfirming] = useState(false)
  const [from, setFrom] = useState<Month>(line.defaultFrom)
  const [archiving, setArchiving] = useState(false)
  const [last, setLast] = useState<Month>(() => defaultLastMonth(ctx, line))
  const { busy, message, run } = useWriter(refresh)
  const state = draftState(line, draft)
  const preview = confirming && state.changed ? previewChange(ctx, line, draft, from) : null
  const archive = archiving ? previewArchive(ctx, line, last) : null

  const send = async (body: Omit<UpdateLineRequest, 'rowVersion'>) => {
    // The version read now: after « Modifié entre-temps » the data are reloaded, so sending again
    // goes with the new one, once the person has looked.
    const ok = await run(() => apiSend('PATCH', `/api/budget-lines/${line.id}`, { rowVersion: line.rowVersion, ...body } satisfies UpdateLineRequest))
    if (ok) {
      setConfirming(false)
      setDraft((d) => ({ ...d, anchor: null }))
    }
  }

  const save = (e: Event) => {
    e.preventDefault()
    if (state.invalid) return
    if (state.changed) {
      setFrom(line.defaultFrom)
      setConfirming(true)
    } else if (state.renamed) void send({ label: draft.label.trim() })
  }

  return (
    <>
      <form class="line-form" onSubmit={save}>
        <Fields ctx={ctx} draft={draft} set={(d) => (setDraft(d), setConfirming(false))} line={line} />
        {state.invalid && <p class="caption pl-muted">{state.invalid}</p>}
        {!confirming && (
          <div class="pl-actions">
            <button type="submit" class="pl-btn pl-btn--primary label" disabled={busy || state.invalid !== null || (!state.changed && !state.renamed)}>
              Enregistrer
            </button>
          </div>
        )}
      </form>
      <MessageLine message={message} />
      {preview && (
        <div class="line-confirm" role="group" aria-label="Confirmer la modification">
          <p class="body">
            À partir de <MonthSelect label="À partir de" inline value={from} months={fromChoices(ctx, line)} onChange={setFrom} />
          </p>
          {preview.ok ? (
            <>
              <p class="caption">Mois concernés : {sentence(preview.value.months)}</p>
              {preview.value.kept.length > 0 && <p class="caption">Surcharges gardées : {preview.value.kept.map(overrideNoteText).join(', ')}.</p>}
              {preview.value.removed.length > 0 && <p class="caption line-removed">Surcharges retirées : {preview.value.removed.map(overrideNoteText).join(', ')}.</p>}
              <p class="caption pl-muted">Les mois d'avant ne changent pas.</p>
            </>
          ) : (
            <p class="caption line-removed">{preview.error}</p>
          )}
          <div class="pl-actions">
            <button
              type="button"
              class="pl-btn pl-btn--primary label"
              disabled={busy || !preview.ok}
              onClick={() => void send({ ...(state.renamed ? { label: draft.label.trim() } : {}), change: changeRequest(line, draft, from) })}
            >
              Confirmer
            </button>
            <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      <div class="pl-group">
        <h3 class="title-s">Archivage</h3>
        {archive ? (
          <div class="line-confirm">
            <p class="body">
              Dernier mois : <MonthSelect label="Dernier mois" inline value={last} months={lastMonthChoices(ctx, line)} onChange={setLast} />
            </p>
            {archive.ok ? (
              <>
                <p class="caption">Ne compte plus dès {monthLabel(archive.value.from)}.</p>
                {archive.value.removed.length > 0 && <p class="caption line-removed">Surcharges retirées : {archive.value.removed.map(overrideNoteText).join(', ')}.</p>}
                <p class="caption pl-muted">L'historique reste intact ; on ne désarchive pas dans cette version.</p>
              </>
            ) : (
              <p class="caption line-removed">{archive.error}</p>
            )}
            <div class="pl-actions">
              <button
                type="button"
                class="pl-btn pl-btn--primary label"
                disabled={busy || !archive.ok}
                onClick={async () => {
                  const ok = await run(() => apiSend('POST', `/api/budget-lines/${line.id}/archive`, { rowVersion: line.rowVersion, lastMonth: last } satisfies ArchiveLineRequest))
                  if (ok) setArchiving(false)
                }}
              >
                Archiver
              </button>
              <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setArchiving(false)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <button type="button" class="pl-btn label" disabled={busy || lastMonthChoices(ctx, line).length === 0} onClick={() => setArchiving(true)}>
            {line.endMonth === null ? 'Archiver la ligne…' : `Avancer le dernier mois (${monthLabel(line.endMonth)})…`}
          </button>
        )}
      </div>
    </>
  )
}

/** The small window of an override (spec 3.6): amount, optional reason, « 0 € ce mois », « Retirer la surcharge ». */
export function OverrideDialog(props: { target: OverrideTarget; refresh: () => Promise<void>; onClose: () => void }) {
  const { target: t } = props
  const ref = useRef<HTMLDialogElement>(null)
  const [amount, setAmount] = useState(() => String((t.current?.amountCents ?? t.versionCents) / 100).replace('.', ','))
  const [reason, setReason] = useState(t.current?.reason ?? '')
  const { busy, message, run } = useWriter(props.refresh)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  const cents = parseEuros(amount)
  const valid = cents !== null && cents >= 0
  const path = `/api/budget-lines/${t.lineId}/override`
  const write = async (amountCents: number) => {
    const body: OverrideRequest = { rowVersion: t.rowVersion, month: t.month, amountCents, reason: reason.trim() === '' ? null : reason.trim() }
    if (await run(() => apiSend('POST', path, body))) props.onClose()
  }
  const remove = async () => {
    const body: RemoveOverrideRequest = { rowVersion: t.rowVersion, month: t.month }
    if (await run(() => apiSend('POST', `${path}/remove`, body))) props.onClose()
  }
  return (
    <dialog ref={ref} class="line-dialog" aria-label={`Surcharger ${t.label}, ${monthLabel(t.month)}`} onClose={props.onClose}>
      <form
        class="line-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void write(cents as number)
        }}
      >
        <div class="month-panel__head">
          <div>
            <h2 class="title-m">{t.label}</h2>
            <span class="caption pl-muted">Surcharge · {monthLabel(t.month)}</span>
          </div>
          <button type="button" class="pl-btn pl-btn--ghost label" onClick={props.onClose}>
            Fermer
          </button>
        </div>
        <label class="pl-field">
          <span class="pl-field__label label">Montant ce mois</span>
          <span class="line-rhythm">
            <span class="pl-input">
              <input type="text" inputMode="decimal" autoFocus value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
              <span>€</span>
            </span>
            <span class="caption pl-muted">au lieu de {euros(t.versionCents)}</span>
          </span>
        </label>
        <label class="pl-field">
          <span class="pl-field__label label">Motif</span>
          <span class="pl-input catalog-text">
            <input type="text" maxLength={500} placeholder="Facultatif" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
          </span>
        </label>
        {!valid && amount.trim() !== '' && <p class="caption pl-muted">Montant : un nombre, 0 ou plus, en euros.</p>}
        {t.current && <p class="caption pl-muted">Changer la surcharge la retire et en crée une nouvelle : l'historique garde les deux.</p>}
        <div class="pl-actions line-dialog__actions">
          {t.current && (
            <button type="button" class="pl-btn pl-btn--ghost label" disabled={busy} onClick={() => void remove()}>
              Retirer la surcharge
            </button>
          )}
          <button type="button" class="pl-btn label" disabled={busy} onClick={() => void write(0)}>
            0 € ce mois
          </button>
          <button type="submit" class="pl-btn pl-btn--primary label" disabled={busy || !valid}>
            Enregistrer
          </button>
        </div>
        <MessageLine message={message} />
      </form>
    </dialog>
  )
}
