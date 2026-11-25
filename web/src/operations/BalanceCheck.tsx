// Balance check (spec 3.2, U8): the result of a check, after an import or by hand, and the small
// window of « Vérifier le solde » (computer). The bank's balance is the one of today
// (DECISIONS.md, 2026-11-25); the Worker computes the gap with C7 and keeps it.

import { useEffect, useRef, useState } from 'preact/hooks'
import type { BalanceCheckRequest, BalanceCheckResult } from '../../../shared/src/api'
import { monthOf, type Id } from '../../../shared/src/engine'
import { apiSend } from '../api'
import { useWriter } from '../budget/write'
import { count, eurosOrMinus, fullDate, parseEuros, shortDate, signedEuros } from '../format'
import type { MonthContext } from '../month/view'
import { navigate, operationsPath } from '../router'
import { enteredSince, gapWords } from './importing'

/** How many operations the list of a gap shows; the rest are counted. */
const SHOWN = 30

export interface CheckFigures {
  id: Id
  date: string
  bankBalanceCents: number
  gapCents: number
}

/** The figures of a check, then, if there is a gap, the operations entered since the one before. */
export function CheckResult({ ctx, check, afterImport = false }: { ctx: MonthContext; check: CheckFigures; afterImport?: boolean }) {
  const { since: lastRight, operations: since } = check.gapCents === 0 ? { since: null, operations: [] } : enteredSince(ctx, check.id)
  const open = (id: Id, valueDate: string) => {
    const month = monthOf(valueDate)
    navigate(operationsPath(month === monthOf(ctx.today) ? null : month, id))
  }
  return (
    <div class="check-result">
      <div class="pl-kv check-figures">
        <div>
          <span class="caption">Banque au {shortDate(check.date)}</span>
          <b class="amount-m">{eurosOrMinus(check.bankBalanceCents)}</b>
        </div>
        <div>
          <span class="caption">Appli à cette date</span>
          <b class="amount-m">{eurosOrMinus(check.bankBalanceCents + check.gapCents)}</b>
        </div>
        <div>
          <span class="caption">Écart</span>
          <b class={`amount-m${check.gapCents === 0 ? '' : ' pl-over'}`}>{check.gapCents === 0 ? 'aucun' : signedEuros(check.gapCents)}</b>
        </div>
      </div>
      {check.gapCents === 0 ? (
        <p class="body" role="status">
          {gapWords(0)}
        </p>
      ) : (
        <p class="pl-banner pl-banner--over" role="status">
          {gapWords(check.gapCents)} {afterImport ? 'Une opération oubliée ou en double, ou le relevé d’un autre compte ?' : 'Une opération oubliée ou en double, ou une faute de frappe ?'}
        </p>
      )}
      {check.gapCents !== 0 && since.length > 0 && (
        <div class="pl-group">
          <h3 class="title-s">
            {count(since.length, 'opération entrée', 'opérations entrées')}{' '}
            {lastRight ? `depuis la dernière vérification sans écart, le ${shortDate(lastRight)}` : 'depuis la mise en service'}
          </h3>
          <div class="pl-list check-list">
            {since.slice(0, SHOWN).map((o) => (
              <button type="button" key={o.id} class="pl-item" onClick={() => open(o.id, o.valueDate)}>
                <span class="pl-item__a table">
                  <span class="op-label__line">
                    {shortDate(o.valueDate)} · {o.label}
                  </span>
                  <span class="pl-num">{signedEuros(o.amountCents)}</span>
                </span>
              </button>
            ))}
          </div>
          {since.length > SHOWN && <p class="caption pl-muted">Et {count(since.length - SHOWN, 'autre')}, dans Opérations.</p>}
        </div>
      )}
    </div>
  )
}

/** « Vérifier le solde » (computer): the bank's balance today, then the result. */
export function CheckDialog(props: { ctx: MonthContext; refresh: () => Promise<void>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [amount, setAmount] = useState('')
  const [result, setResult] = useState<CheckFigures | null>(null)
  const { busy, message, run } = useWriter(props.refresh)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  const cents = parseEuros(amount)
  const check = async () => {
    if (cents === null) return
    let answer: BalanceCheckResult | null = null
    const body: BalanceCheckRequest = { bankBalanceCents: cents }
    if (await run(async () => (answer = await apiSend<BalanceCheckResult>('POST', '/api/balance-checks', body)))) {
      setResult((answer as BalanceCheckResult | null)?.check ?? null)
    }
  }
  return (
    <dialog ref={ref} class="line-dialog check-dialog" aria-label="Vérifier le solde" onClose={props.onClose}>
      <form
        class="line-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!result) void check()
        }}
      >
        <div class="month-panel__head">
          <div>
            <h2 class="title-m">Vérifier le solde</h2>
            <span class="caption pl-muted">{fullDate(props.ctx.today)}</span>
          </div>
          <button type="button" class="pl-btn pl-btn--ghost label" onClick={props.onClose}>
            Fermer
          </button>
        </div>
        {result ? (
          <CheckResult ctx={props.ctx} check={result} />
        ) : (
          <>
            <label class="pl-field">
              <span class="pl-field__label label">Solde affiché par la banque aujourd'hui</span>
              <span class="pl-input">
                <input type="text" inputMode="decimal" autoFocus value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
                <span>€</span>
              </span>
            </label>
            {cents === null && amount.trim() !== '' && <p class="caption pl-muted">Montant : un nombre en euros, avec « - » s'il est négatif.</p>}
            <p class="caption pl-muted">L'appli compare avec son solde du jour, en date de valeur, et garde le résultat.</p>
            <div class="pl-actions line-dialog__actions">
              <button type="submit" class="pl-btn pl-btn--primary label" disabled={busy || cents === null}>
                Vérifier
              </button>
            </div>
          </>
        )}
        {message && (
          <p class="pl-banner pl-banner--over" role="alert">
            {message.text}
          </p>
        )}
      </form>
    </dialog>
  )
}
