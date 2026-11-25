// Screen 3.8, setup (computer only): on an empty database the app opens here instead of the
// current month. One choice in this lot, « Commencer »: the bank balance at the end of the
// previous month, and the six initial sections. « Restaurer depuis un export » arrives in lot 11.

import { useState } from 'preact/hooks'
import type { SetupRequest } from '../../../shared/src/api'
import { addMonths, lastDayOfMonth, monthOf } from '../../../shared/src/engine'
import { apiSend } from '../api'
import { fullDate, monthTitle, parseEuros } from '../format'
import { navigate } from '../router'
import { useWriter } from './write'

export function SetupScreen({ today, narrow, refresh }: { today: string; narrow: boolean; refresh: () => Promise<void> }) {
  const { busy, message, run } = useWriter(refresh)
  const [text, setText] = useState('')
  if (narrow) {
    return (
      <div class="setup">
        <h1 class="title-l">Mise en service</h1>
        <p class="body">Mise en service à faire sur ordinateur.</p>
      </div>
    )
  }
  const previous = addMonths(monthOf(today), -1)
  const date = lastDayOfMonth(previous)
  const cents = parseEuros(text)
  return (
    <div class="setup">
      <h1 class="title-l">Mise en service</h1>
      <p class="body">
        Saisis le solde du compte commun à la fin de {monthTitle(previous)} ({fullDate(date)}), tel que ta banque l'affiche. Le premier import couvrira
        le mois en cours depuis le 1er : il se suit alors en entier, avec le budget habituel.
      </p>
      <form
        class="catalog-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (cents === null) return
          const ok = await run(() => apiSend('POST', '/api/setup', { amountCents: cents } satisfies SetupRequest))
          if (ok) navigate('/budget/categories')
        }}
      >
        <label class="pl-field">
          <span class="pl-field__label label">Solde au {fullDate(date)}</span>
          <span class={`pl-input${text !== '' && cents === null ? ' pl-input--error' : ''}`}>
            <input type="text" inputMode="decimal" autoFocus value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-invalid={text !== '' && cents === null} />
            <span>€</span>
          </span>
          {text !== '' && cents === null && <span class="pl-field__error caption">Un montant en euros, par exemple 3 000,00</span>}
        </label>
        <p class="caption pl-muted">
          L'appli crée six sections : Revenus réguliers, Revenus ponctuels, Dépenses fixes, Dépenses courantes, Dépenses ponctuelles et Épargne. Tu pourras
          les modifier ensuite.
        </p>
        <button type="submit" class="pl-btn pl-btn--primary label" disabled={busy || cents === null}>
          Commencer
        </button>
      </form>
      {message && <p class={`pl-banner${message.kind === 'error' ? ' pl-banner--over' : ''}`} role="alert">{message.text}</p>}
    </div>
  )
}
