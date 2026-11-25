// Lot 11: export and restore in the app (spec 3.8, 4.6), computer only.
//
// Export: everything is read again (the same paged requests as at start), the file is built here
// and downloaded, then the server records the date. The file goes straight from the app to the
// computer: no other intermediary.
//
// Restore: the chosen file is read here (format, schema, environment), its summary shown, then
// sent in lots one after the other. A lot refused after the first leaves the base blocked, until
// « Vider la base ».

import { useCallback, useState } from 'preact/hooks'
import type { Environment, ExportRecorded, MeResponse, RestoreLotResult } from '../../../shared/src/api'
import {
  buildExport,
  exportFileName,
  readExport,
  RESTORE_LOT_ROWS,
  restoreLots,
  type ExportFile,
  type ExportSummary,
  type ReadExportError,
} from '../../../shared/src/backup'
import { apiGet, apiSend, browserDeps, RuleError, type ApiDeps } from '../api'
import { readAll } from '../data'
import { messageOf, type Message } from './write'

/**
 * A timestamp on the simulated day, when there is one (local and staging only): the reminder
 * compares the date of the last export with "today" (spec 3.8).
 */
export const onDay = (timestamp: string, day: string | null) => (day ? `${day}${timestamp.slice(10)}` : timestamp)

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.hidden = true
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Builds and downloads the file, then records the date; returns the file name. */
export async function exportData(deps: ApiDeps = browserDeps(), save = download): Promise<string> {
  const [me, { res }] = await Promise.all([apiGet<MeResponse>('/api/me', deps), readAll(deps)])
  const exportedAt = onDay(new Date().toISOString(), res.todaySimulated ? res.today : null)
  const name = exportFileName(res.environment, exportedAt)
  save(name, JSON.stringify(buildExport(res, me.firstName, exportedAt)))
  await apiSend<ExportRecorded>('POST', '/api/exports', {}, deps)
  return name
}

/** « Exporter les données », from Budget > Données or the reminder of the current month. */
export function useExport(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'done' | 'error'; text: string } | null>(null)
  const run = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const name = await exportData()
      await refresh().catch(() => undefined)
      setMessage({ kind: 'done', text: `Export téléchargé : ${name}. Range-le dans un dossier personnel.` })
    } catch (e) {
      setMessage({ kind: 'error', text: messageOf(e).text })
    }
    setBusy(false)
  }, [refresh])
  return { busy, message, run }
}

export function readExportText(error: ReadExportError, target: Environment): string {
  switch (error) {
    case 'not_export':
      return "Ce fichier n'est pas un export de Plootos."
    case 'newer_schema':
      return "Cet export vient d'une version plus récente de l'appli : recharge la page, puis réessaie."
    case 'other_environment':
      return target === 'production'
        ? "Cet export vient de la recette : il ne se restaure pas en production."
        : "Cet export contient les données réelles : il ne se restaure qu'en production."
    case 'invalid':
      return 'Ce fichier est abîmé ou incomplet : rien ne peut être restauré.'
  }
}

export type ChosenFile = { ok: true; file: ExportFile; summary: ExportSummary } | { ok: false; text: string }

export async function chooseFile(file: File, target: Environment): Promise<ChosenFile> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, text: "Le fichier n'a pas pu être lu." }
  }
  const read = readExport(text, target)
  return read.ok ? read : { ok: false, text: readExportText(read.error, target) }
}

export type RestoreOutcome =
  | { kind: 'done' }
  /** Refused at the first lot: nothing written, the screen stays. */
  | { kind: 'refused'; message: Message }
  /** Refused or cut after the first lot: the base is blocked. */
  | { kind: 'blocked' }

const REFUSED_FILE = new Set(['invalid_value', 'invalid_link', 'duplicate', 'bad_request'])

/** Sends the lots one after the other; `progress` after each one. */
export async function restoreFile(
  file: ExportFile,
  progress: (sent: number, total: number) => void,
  deps: ApiDeps = browserDeps(),
  maxRows = RESTORE_LOT_ROWS,
): Promise<RestoreOutcome> {
  const lots = restoreLots(file, maxRows)
  for (const lot of lots) {
    try {
      await apiSend<RestoreLotResult>('POST', '/api/restore', lot, deps)
    } catch (e) {
      if (lot.lot > 0) return { kind: 'blocked' }
      if (e instanceof RuleError && REFUSED_FILE.has(e.code)) {
        return { kind: 'refused', message: { kind: 'error', text: "Le fichier contient des données incohérentes : rien n'est restauré." } }
      }
      return { kind: 'refused', message: messageOf(e) }
    }
    progress(lot.lot + 1, lots.length)
  }
  return { kind: 'done' }
}
