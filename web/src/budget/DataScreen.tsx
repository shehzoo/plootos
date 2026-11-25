// Tab « Données » of Budget (spec 3.8, computer only): « Exporter les données » and the date of
// the last export (lot 11, spec 4.6); the opening balance, its date fixed at setup and its amount
// editable.

import { useState } from 'preact/hooks'
import type { OpeningBalanceRequest } from '../../../shared/src/api'
import { apiSend } from '../api'
import { dateTime, euros, fullDate, parseEuros } from '../format'
import type { MonthContext } from '../month/view'
import { useExport } from './backup'
import { useWriter } from './write'

function ExportPanel({ lastExportAt, refresh }: { lastExportAt: string | null; refresh: () => Promise<void> }) {
  const { busy, message, run } = useExport(refresh)
  return (
    <section class="pl-panel catalog-data" aria-label="Exporter les données">
      <h2 class="title-m">Exporter les données</h2>
      <p class="body">{lastExportAt ? `Dernier export : le ${dateTime(lastExportAt)}.` : 'Aucun export pour l’instant.'}</p>
      <p class="caption pl-muted">
        Un fichier JSON avec toutes les données, éléments archivés compris : la copie de secours hors de Cloudflare, et le fichier de « Restaurer
        depuis un export ». Range-le dans un dossier personnel. Un bandeau le rappelle sur le mois en cours au-delà d'un mois.
      </p>
      <button type="button" class="pl-btn pl-btn--primary label" disabled={busy} onClick={run}>
        {busy ? 'Export…' : 'Exporter les données'}
      </button>
      {message && (
        <p class={message.kind === 'error' ? 'pl-banner pl-banner--over' : 'body'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </section>
  )
}

const asText = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

export function DataScreen({ ctx, refresh }: { ctx: MonthContext; refresh: () => Promise<void> }) {
  const opening = ctx.app.openingBalance
  const { busy, message, run } = useWriter(refresh)
  const [text, setText] = useState(opening ? asText(opening.amountCents) : '')
  if (!opening) return null
  const cents = parseEuros(text)
  const unchanged = cents === opening.amountCents
  return (
    <div class="month">
      <header class="ops-head">
        <div class="month-title">
          <h1 class="title-l">Budget</h1>
          <span class="caption pl-muted">Données</span>
        </div>
      </header>
      <div class="month__body">
        <div class="month-table data-panels">
          <ExportPanel lastExportAt={ctx.lastExportAt ?? null} refresh={refresh} />
          <section class="pl-panel catalog-data" aria-label="Solde initial">
            <h2 class="title-m">Solde initial</h2>
            <p class="body">
              {euros(opening.amountCents)} au {fullDate(opening.balanceDate)}, solde de la banque à la fin du mois qui précède la mise en service.
            </p>
            <p class="caption pl-muted">
              La date est fixée par l'appli. Une faute de frappe dans le montant se voit à la première vérification du solde.
            </p>
            <form
              class="catalog-form"
              onSubmit={async (e) => {
                e.preventDefault()
                if (cents === null || unchanged) return
                await run(() =>
                  apiSend('PATCH', '/api/opening-balance', { rowVersion: opening.rowVersion, amountCents: cents } satisfies OpeningBalanceRequest),
                )
              }}
            >
              <label class="pl-field">
                <span class="pl-field__label label">Montant</span>
                <span class={`pl-input${cents === null ? ' pl-input--error' : ''}`}>
                  <input type="text" inputMode="decimal" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-invalid={cents === null} />
                  <span>€</span>
                </span>
                {cents === null && <span class="pl-field__error caption">Un montant en euros, par exemple 3 000,00</span>}
              </label>
              <button type="submit" class="pl-btn label" disabled={busy || cents === null || unchanged}>
                Enregistrer le montant
              </button>
            </form>
            {message && <p class={`pl-banner${message.kind === 'error' ? ' pl-banner--over' : ''}`} role="alert">{message.text}</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
