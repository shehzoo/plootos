// Import of a statement (spec 3.2, 4.4), on its own screen, on a computer (DECISIONS.md,
// 2026-11-25). Steps: choose the XLSX file, read here; the Worker sorts the rows; the summary
// (already present, entries to merge one by one, new, set aside) and the foreseeable gap,
// updated with each choice; « Importer »; then the balance check and where to go next.
// Nothing from above the statement's header leaves the computer but its « Solde au ».

import { useRef, useState } from 'preact/hooks'
import { MAX_IMPORT_ROWS, type ImportChanged, type ImportPreview, type ImportRequest, type ImportResult } from '../../../shared/src/api'
import type { Id } from '../../../shared/src/engine'
import { readStatement, type SheetRows, type Statement } from '../../../shared/src/statement'
import { apiSend, RuleError } from '../api'
import { messageOf, type Message } from '../budget/write'
import { count, eurosOrMinus, fullDate, shortDate, signedEuros } from '../format'
import { Icon } from '../icons'
import type { MonthContext } from '../month/view'
import { back, CATEGORIZE_PATH, navigate, operationsPath } from '../router'
import { CheckResult } from './BalanceCheck'
import { todoCount } from './entry'
import {
  foreseenGap,
  gapWords,
  keptChoices,
  manualText,
  MAX_FILE_BYTES,
  mergeRows,
  newCount,
  pairsOf,
  previewRequest,
  statementErrorText,
  undecidedCount,
  type MergeChoices,
} from './importing'

type Step =
  | { kind: 'choose'; error: string | null }
  | { kind: 'reading' }
  | { kind: 'summary'; fileName: string; statement: Statement; preview: ImportPreview; choices: MergeChoices; note: string | null }
  | { kind: 'done'; fileName: string; result: ImportResult }

/** Reads the file on this computer: the library is loaded only when a file is chosen. */
async function readFile(file: File): Promise<Statement | string> {
  if (file.size > MAX_FILE_BYTES) return statementErrorText({ error: 'too_big' })
  let rows: SheetRows
  try {
    const { readSheet } = await import('read-excel-file/browser')
    // Numbers kept as their text: amounts become cents without floating point.
    rows = (await readSheet<string>(file, { parseNumber: (s) => s })) as SheetRows
  } catch {
    return statementErrorText({ error: 'not_xlsx' })
  }
  const read = readStatement(rows, MAX_IMPORT_ROWS)
  return 'error' in read ? statementErrorText(read) : read
}

function Head({ subtitle }: { subtitle: string }) {
  return (
    <header class="ops-head todo-head">
      <div class="month-title">
        <button type="button" class="pl-btn pl-btn--ghost label todo-back" onClick={() => back(operationsPath(null, null))}>
          <Icon name="chevron-gauche" />
          Opérations
        </button>
        <h1 class="title-l">Importer un relevé</h1>
        <span class="caption pl-muted">{subtitle}</span>
      </div>
    </header>
  )
}

function Choose({ error, onFile }: { error: string | null; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div class="import-choose">
      <label
        class={`import-drop${over ? ' import-drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer?.files[0]
          if (f) onFile(f)
        }}
      >
        <span class="title-s">Dépose ici le relevé XLSX</span>
        <span class="body pl-muted">ou</span>
        <span class="pl-btn pl-btn--primary label">Choisir le fichier</span>
        <input
          ref={input}
          type="file"
          class="import-file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0]
            if (f) onFile(f)
            if (input.current) input.current.value = ''
          }}
        />
      </label>
      {error && (
        <p class="pl-banner pl-banner--over" role="alert">
          {error}
        </p>
      )}
      <p class="caption pl-muted">
        Le relevé des opérations, au format Excel, téléchargé sur le site du Crédit Agricole. Le fichier est lu sur cet ordinateur : seuls
        les opérations et le solde du relevé sont envoyés, jamais les noms ni le numéro de compte. Les opérations déjà présentes sont
        reconnues et ignorées.
      </p>
    </div>
  )
}

/** The choice for one row to merge: one entry (two buttons), or several (a list). */
function MergeChoice(props: {
  ctx: MonthContext
  rowIndex: number
  candidates: Id[]
  /** Entries already paired with another row of the same group. */
  taken: Set<Id>
  value: Id | 'none' | undefined
  set: (v: Id | 'none') => void
}) {
  const { candidates, value } = props
  const only = candidates.length === 1 ? (candidates[0] as Id) : null
  if (only !== null) {
    return (
      <div class="import-merge__choice">
        <span class="caption pl-muted">{manualText(props.ctx, only)}</span>
        <div class="pl-seg" role="group" aria-label="Fusionner avec la saisie ?">
          <button type="button" aria-pressed={value === only} onClick={() => props.set(only)}>
            Fusionner
          </button>
          <button type="button" aria-pressed={value === 'none'} onClick={() => props.set('none')}>
            Ne pas fusionner
          </button>
        </div>
      </div>
    )
  }
  return (
    <div class="import-merge__choice">
      <select
        class="catalog-select"
        aria-label="Saisie à fusionner avec cette ligne"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value
          if (v !== '') props.set(v === 'none' ? 'none' : Number(v))
        }}
      >
        <option value="" disabled>
          Choisir…
        </option>
        {candidates.map((id) => (
          <option key={id} value={String(id)} disabled={props.taken.has(id) && value !== id}>
            Fusionner : {manualText(props.ctx, id)}
          </option>
        ))}
        <option value="none">Ne pas fusionner : importer comme nouvelle</option>
      </select>
    </div>
  )
}

function Summary(props: {
  ctx: MonthContext
  step: Extract<Step, { kind: 'summary' }>
  busy: boolean
  message: Message | null
  setChoices: (c: MergeChoices) => void
  onImport: () => void
  onCancel: () => void
}) {
  const { ctx, step } = props
  const { statement, preview, choices } = step
  const rows = statement.rows
  const dates = rows.map((r) => r.valueDate).sort()
  const undecided = undecidedCount(preview, choices)
  const fresh = newCount(preview, choices)
  const merged = pairsOf(choices).length
  const gap = foreseenGap(preview, rows, choices, statement.balance)
  const opening = ctx.ledger.data.openingBalance.balanceDate
  const groupOf = new Map(preview.toMerge.flatMap((g) => g.rowIndexes.map((i) => [i, g] as const)))
  const set = (rowIndex: number, v: Id | 'none') => {
    const next = new Map(choices)
    next.set(rowIndex, v)
    props.setChoices(next)
  }
  const action =
    fresh === 0 && merged === 0
      ? 'Enregistrer la vérification'
      : [fresh > 0 ? `Importer ${count(fresh, 'opération')}` : null, merged > 0 ? `${fresh > 0 ? 'fusionner' : 'Fusionner'} ${merged}` : null].filter(Boolean).join(' et ')

  return (
    <div class="import-summary">
      <p class="body">
        <b>{step.fileName}</b> : {count(rows.length, 'opération')} du {shortDate(dates[0] as string)} au {shortDate(dates[dates.length - 1] as string)} (date de
        valeur). Solde au {fullDate(statement.balance.date)} : <b>{eurosOrMinus(statement.balance.balanceCents)}</b>.
      </p>

      <div class="pl-table import-counts">
        <div class="pl-row table">
          <span>Déjà présentes, ignorées</span>
          <span class="pl-num">{preview.alreadyPresent.length}</span>
        </div>
        <div class="pl-row table">
          <span>Saisies à fusionner</span>
          <span class="pl-num">{mergeRows(preview).length}</span>
        </div>
        <div class="pl-row table">
          <span>Nouvelles</span>
          <span class="pl-num">{preview.fresh.length}</span>
        </div>
        {preview.excluded.length > 0 && (
          <div class="pl-row table">
            <span>
              Écartées : date de valeur au plus tard le {shortDate(opening)}, jour du solde initial
            </span>
            <span class="pl-num">{preview.excluded.length}</span>
          </div>
        )}
      </div>

      {preview.toMerge.length > 0 && (
        <div class="pl-group import-merges">
          <h2 class="title-m">Saisies à fusionner</h2>
          <p class="caption pl-muted">
            Une ligne du relevé a la même date de valeur et le même montant qu'une saisie. Fusionner garde la catégorie et le commentaire
            de la saisie, avec le libellé de la banque. Ne pas fusionner importe la ligne comme nouvelle et garde la saisie : l'écart de
            solde le signalera.
          </p>
          {mergeRows(preview).map((i) => {
            const r = rows[i]
            const g = groupOf.get(i)
            if (!r || !g) return null
            const taken = new Set(
              g.rowIndexes
                .filter((j) => j !== i)
                .map((j) => choices.get(j))
                .filter((v): v is Id => v !== undefined && v !== 'none'),
            )
            return (
              <div key={i} class="pl-row table import-merge">
                <span class="pl-muted">{shortDate(r.valueDate)}</span>
                <span class="op-label">
                  <span class="op-label__line" title={r.bankLabel}>
                    {r.bankLabel}
                  </span>
                </span>
                <span class="pl-num">{signedEuros(r.amountCents)}</span>
                <MergeChoice ctx={ctx} rowIndex={i} candidates={g.operationIds} taken={taken} value={choices.get(i)} set={(v) => set(i, v)} />
              </div>
            )
          })}
        </div>
      )}

      <div class="pl-group">
        <h2 class="title-m">Écart de solde prévisible</h2>
        {undecided > 0 ? (
          <p class="body pl-muted">Choisis les fusions ci-dessus : l'écart en dépend.</p>
        ) : (
          <>
            <div class="pl-kv check-figures">
              <div>
                <span class="caption">Banque au {shortDate(statement.balance.date)}</span>
                <b class="amount-m">{eurosOrMinus(statement.balance.balanceCents)}</b>
              </div>
              <div>
                <span class="caption">Appli après l'import</span>
                <b class="amount-m">{eurosOrMinus(statement.balance.balanceCents + gap)}</b>
              </div>
              <div>
                <span class="caption">Écart</span>
                <b class={`amount-m${gap === 0 ? '' : ' pl-over'}`}>{gap === 0 ? 'aucun' : signedEuros(gap)}</b>
              </div>
            </div>
            {gap !== 0 && (
              <p class="pl-banner pl-banner--over" role="status">
                {gapWords(gap)} Relevé d'un autre compte, opération oubliée, ou saisie en double non fusionnée ?
              </p>
            )}
          </>
        )}
      </div>

      {step.note && (
        <p class="pl-banner" role="status">
          {step.note}
        </p>
      )}
      {props.message && (
        <p class="pl-banner pl-banner--over" role="alert">
          {props.message.text}
        </p>
      )}
      <div class="pl-actions todo-foot">
        <button type="button" class="pl-btn pl-btn--ghost label" disabled={props.busy} onClick={props.onCancel}>
          Choisir un autre fichier
        </button>
        <button type="button" class="pl-btn pl-btn--primary label" disabled={props.busy || undecided > 0} onClick={props.onImport}>
          {undecided > 0 ? `${count(undecided, 'fusion')} à choisir` : action}
        </button>
      </div>
    </div>
  )
}

function Done({ ctx, step }: { ctx: MonthContext; step: Extract<Step, { kind: 'done' }> }) {
  const { result } = step
  const todo = todoCount(ctx)
  const parts = [
    result.imported > 0 ? `${count(result.imported, 'opération importée', 'opérations importées')}` : 'Aucune opération nouvelle',
    result.merged > 0 ? `${count(result.merged, 'saisie fusionnée', 'saisies fusionnées')}` : null,
  ].filter(Boolean)
  return (
    <div class="import-summary">
      <p class="body" role="status">
        <b>{parts.join(', ')}.</b> Vérification du solde enregistrée.
      </p>
      <CheckResult ctx={ctx} check={result.check} afterImport />
      <div class="pl-actions">
        {todo > 0 && (
          <button type="button" class="pl-btn pl-btn--primary label" onClick={() => navigate(CATEGORIZE_PATH)}>
            Catégoriser ({todo})
          </button>
        )}
        <button type="button" class="pl-btn label" onClick={() => navigate(operationsPath(null, null))}>
          Voir les opérations
        </button>
      </div>
    </div>
  )
}

export function ImportScreen({ ctx, narrow, refresh }: { ctx: MonthContext; narrow: boolean; refresh: () => Promise<void> }) {
  const [step, setStep] = useState<Step>({ kind: 'choose', error: null })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  if (narrow) {
    return (
      <div class="detail-page">
        <header class="detail-page__head">
          <button type="button" class="pl-iconbtn" aria-label="Retour" onClick={() => back(operationsPath(null, null))}>
            <Icon name="chevron-gauche" />
          </button>
          <div>
            <h1 class="title-m">Importer un relevé</h1>
          </div>
        </header>
        <p class="body pl-muted month-empty">L'import se fait sur ordinateur.</p>
      </div>
    )
  }

  const onFile = async (file: File) => {
    setMessage(null)
    setStep({ kind: 'reading' })
    const read = await readFile(file)
    if (typeof read === 'string') {
      setStep({ kind: 'choose', error: read })
      return
    }
    try {
      const preview = await apiSend<ImportPreview>('POST', '/api/import/preview', previewRequest(read))
      setStep({ kind: 'summary', fileName: file.name, statement: read, preview, choices: new Map(), note: null })
    } catch (e) {
      setStep({ kind: 'choose', error: messageOf(e).text })
    }
  }

  const onImport = async () => {
    if (step.kind !== 'summary') return
    setBusy(true)
    setMessage(null)
    const body: ImportRequest = { ...previewRequest(step.statement), token: step.preview.token, pairs: pairsOf(step.choices) }
    try {
      const result = await apiSend<ImportResult>('POST', '/api/import', body)
      await refresh().catch(() => setMessage({ kind: 'error', text: "Importé, mais l'appli n'a pas pu se recharger : recharge la page." }))
      setStep({ kind: 'done', fileName: step.fileName, result })
    } catch (e) {
      const changed = e instanceof RuleError && e.code === 'import_changed' ? (e.body as ImportChanged | undefined)?.preview : undefined
      await refresh().catch(() => undefined)
      if (changed) {
        // Another import or an entry meanwhile: nothing was written; the new sort, the choices still possible kept.
        setStep({
          ...step,
          preview: changed,
          choices: keptChoices(changed, step.choices),
          note: 'Les opérations ont changé entre-temps (une saisie ou un autre import) : rien n’a été importé. Le récapitulatif est à jour ; vérifie, puis recommence.',
        })
      } else {
        setMessage(messageOf(e))
      }
    }
    setBusy(false)
  }

  const subtitle =
    step.kind === 'done' ? step.fileName : step.kind === 'summary' ? 'Récapitulatif avant import' : 'Relevé XLSX du Crédit Agricole, sur ordinateur'
  return (
    <div class="month todo import">
      <Head subtitle={subtitle} />
      {step.kind === 'choose' && <Choose error={step.error} onFile={(f) => void onFile(f)} />}
      {step.kind === 'reading' && (
        <p class="body pl-muted" aria-busy="true">
          Lecture du relevé…
        </p>
      )}
      {step.kind === 'summary' && (
        <Summary
          ctx={ctx}
          step={step}
          busy={busy}
          message={message}
          setChoices={(choices) => setStep({ ...step, choices, note: null })}
          onImport={() => void onImport()}
          onCancel={() => setStep({ kind: 'choose', error: null })}
        />
      )}
      {step.kind === 'done' && <Done ctx={ctx} step={step} />}
    </div>
  )
}
