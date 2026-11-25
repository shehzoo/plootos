// Screen 3.8, setup (computer only): on an empty database the app opens here instead of the
// current month, with two choices. « Commencer »: the bank balance at the end of the previous
// month, and the six initial sections. « Restaurer depuis un export » (lot 11): a JSON file made
// by « Exporter les données », checked, summed up, then restored on confirmation (spec 4.6).

import { useRef, useState } from 'preact/hooks'
import type { Environment, SetupRequest } from '../../../shared/src/api'
import type { ExportFile, ExportSummary } from '../../../shared/src/backup'
import { addMonths, lastDayOfMonth, monthOf } from '../../../shared/src/engine'
import { apiSend } from '../api'
import { count, dateTime, fullDate, monthTitle, parseEuros } from '../format'
import { navigate } from '../router'
import { chooseFile, restoreFile } from './backup'
import { useWriter, type Message } from './write'

type Restore =
  | { step: 'choose'; error: string | null }
  | { step: 'reading' }
  | { step: 'summary'; fileName: string; file: ExportFile; summary: ExportSummary; message: Message | null }
  | { step: 'sending'; sent: number; total: number }

const ENVIRONMENT_NAME: Record<Environment, string> = { production: 'production', staging: 'recette', local: 'local' }

function Summary({ s, fileName }: { s: ExportSummary; fileName: string }) {
  return (
    <>
      <p class="body">
        <b>{fileName}</b> : export du {dateTime(s.exportedAt)}, par {s.exportedBy}
        {s.environment === 'production' ? '' : ` (${ENVIRONMENT_NAME[s.environment]})`}.
      </p>
      <div class="pl-kv setup-kv">
        <div>
          <span class="caption">Opérations</span>
          <b class="body">{s.operations}</b>
        </div>
        <div>
          <span class="caption">Lignes de budget</span>
          <b class="body">{s.budgetLines}</b>
        </div>
        <div>
          <span class="caption">Période</span>
          <b class="body">
            {fullDate(s.from)} au {fullDate(s.to)}
          </b>
        </div>
      </div>
    </>
  )
}

function RestoreChoice({ environment, refresh }: { environment: Environment; refresh: () => Promise<void> }) {
  const [state, setState] = useState<Restore>({ step: 'choose', error: null })
  const input = useRef<HTMLInputElement>(null)

  const onFile = async (f: File) => {
    setState({ step: 'reading' })
    const chosen = await chooseFile(f, environment)
    if (!chosen.ok) setState({ step: 'choose', error: chosen.text })
    else setState({ step: 'summary', fileName: f.name, file: chosen.file, summary: chosen.summary, message: null })
  }

  const onRestore = async () => {
    if (state.step !== 'summary') return
    const current = state
    setState({ step: 'sending', sent: 0, total: 1 })
    const out = await restoreFile(current.file, (sent, total) => setState({ step: 'sending', sent, total }))
    if (out.kind === 'refused') {
      await refresh().catch(() => undefined)
      setState({ ...current, message: out.message })
      return
    }
    // Done: the month opens. Blocked: the app says « Restauration inachevée » (refresh sees it).
    await refresh().catch(() => undefined)
    if (out.kind === 'done') navigate('/')
  }

  return (
    <section class="setup__choice" aria-label="Restaurer depuis un export">
      <h2 class="title-m">Restaurer depuis un export</h2>
      {(state.step === 'choose' || state.step === 'reading') && (
        <>
          <p class="body">
            Le fichier JSON fait par « Exporter les données ». L'appli vérifie le fichier, montre ce qu'il contient, puis restaure après ta
            confirmation.
          </p>
          <label class="pl-btn label setup-file">
            {state.step === 'reading' ? 'Lecture…' : 'Choisir le fichier'}
            <input
              ref={input}
              type="file"
              class="import-file"
              accept=".json,application/json"
              disabled={state.step === 'reading'}
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0]
                if (f) void onFile(f)
                if (input.current) input.current.value = ''
              }}
            />
          </label>
          {state.step === 'choose' && state.error && (
            <p class="pl-banner pl-banner--over" role="alert">
              {state.error}
            </p>
          )}
        </>
      )}
      {state.step === 'summary' && (
        <>
          <Summary s={state.summary} fileName={state.fileName} />
          <p class="caption pl-muted">
            Garde la page ouverte jusqu'à la fin : une restauration interrompue bloque l'appli jusqu'à l'action GitHub « Vider la base ».
          </p>
          <div class="setup__actions">
            <button type="button" class="pl-btn pl-btn--primary label" onClick={onRestore}>
              Restaurer
            </button>
            <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setState({ step: 'choose', error: null })}>
              Choisir un autre fichier
            </button>
          </div>
          {state.message && (
            <p class="pl-banner pl-banner--over" role="alert">
              {state.message.text}
            </p>
          )}
        </>
      )}
      {state.step === 'sending' && (
        <p class="body" role="status" aria-live="polite">
          Restauration en cours : {state.sent} sur {count(state.total, 'lot')} enregistrés. Garde la page ouverte.
        </p>
      )}
    </section>
  )
}

function StartChoice({ today, refresh }: { today: string; refresh: () => Promise<void> }) {
  const { busy, message, run } = useWriter(refresh)
  const [text, setText] = useState('')
  const previous = addMonths(monthOf(today), -1)
  const date = lastDayOfMonth(previous)
  const cents = parseEuros(text)
  return (
    <section class="setup__choice" aria-label="Commencer">
      <h2 class="title-m">Commencer</h2>
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
    </section>
  )
}

export function SetupScreen(props: { today: string; environment: Environment; narrow: boolean; refresh: () => Promise<void> }) {
  if (props.narrow) {
    return (
      <div class="setup">
        <h1 class="title-l">Mise en service</h1>
        <p class="body">Mise en service à faire sur ordinateur.</p>
      </div>
    )
  }
  return (
    <div class="setup">
      <h1 class="title-l">Mise en service</h1>
      <StartChoice today={props.today} refresh={props.refresh} />
      <RestoreChoice environment={props.environment} refresh={props.refresh} />
    </div>
  )
}
