// Import of a statement and balance check (spec 3.2, 4.4, U8): what the screens show, in pure
// functions. The file is read on the computer; only its operations and its « Solde au » are sent.

import type { ImportPreview, ImportPreviewRequest } from '../../../shared/src/api'
import { importBalanceGap, type Id, type ImportRow, type IsoDate, type MergePair } from '../../../shared/src/engine'
import type { Statement, StatementError } from '../../../shared/src/statement'
import { count, euros, shortDate } from '../format'
import { path, type MonthContext } from '../month/view'

/** Largest file accepted: a year of operations is far below. */
export const MAX_FILE_BYTES = 5_000_000

export function statementErrorText(e: StatementError | { error: 'not_xlsx' | 'too_big' }): string {
  switch (e.error) {
    case 'not_xlsx':
      return "Ce fichier n'est pas un relevé XLSX lisible. Télécharge le relevé au format Excel (XLSX) sur le site du Crédit Agricole."
    case 'too_big':
      return 'Fichier trop gros pour un relevé : vérifie que c’est bien le bon.'
    case 'no_header':
      return 'Fichier non reconnu : la ligne « Date, Date valeur, Libellé, Débit euros, Crédit euros » est introuvable. Rien n’est importé.'
    case 'no_balance':
      return 'Fichier non reconnu : le « Solde au » du relevé est introuvable. Rien n’est importé.'
    case 'bad_row':
      return `Ligne ${e.line} du relevé illisible (date, libellé, ou débit et crédit). Rien n’est importé.`
    case 'no_rows':
      return 'Le relevé ne contient aucune opération.'
    case 'too_many_rows':
      return `Relevé trop long (${count(e.count, 'opération')}) : télécharge une période plus courte, puis importe les périodes l'une après l'autre.`
  }
}

/** What is sent: the rows, the raw first line of each label, and the « Solde au ». */
export function previewRequest(s: Statement): ImportPreviewRequest {
  return {
    balance: s.balance,
    rows: s.rows.map((r) => ({ opDate: r.opDate, valueDate: r.valueDate, amountCents: r.amountCents, bankLabelRaw: r.bankLabelRaw })),
  }
}

/** For each row to merge: the manual entry chosen, or 'none' (import it as new); absent: not decided yet. */
export type MergeChoices = Map<number, Id | 'none'>

export function pairsOf(choices: MergeChoices): MergePair[] {
  return [...choices].filter((e): e is [number, Id] => e[1] !== 'none').map(([rowIndex, operationId]) => ({ rowIndex, operationId }))
}

/** Rows of the groups to merge, in the order of the file. */
export const mergeRows = (p: ImportPreview) => p.toMerge.flatMap((g) => g.rowIndexes).sort((a, b) => a - b)

export const undecidedCount = (p: ImportPreview, choices: MergeChoices) => mergeRows(p).filter((i) => !choices.has(i)).length

/** The choices still possible in a new sort (spec 4.4, step 5: the sort changed meanwhile). */
export function keptChoices(p: ImportPreview, choices: MergeChoices): MergeChoices {
  const kept: MergeChoices = new Map()
  for (const g of p.toMerge) {
    for (const i of g.rowIndexes) {
      const c = choices.get(i)
      if (c === 'none' || (c !== undefined && g.operationIds.includes(c))) kept.set(i, c)
    }
  }
  return kept
}

/** Operations written as new: the new rows, and the rows to merge left without a pair. */
export function newCount(p: ImportPreview, choices: MergeChoices): number {
  const merged = pairsOf(choices).length
  return p.fresh.length + mergeRows(p).length - merged
}

/** Foreseeable gap (spec 4.4, step 4): the app balance at the statement date once imported, minus the bank's. */
export function foreseenGap(p: ImportPreview, rows: ImportRow[], choices: MergeChoices, balance: { date: IsoDate; balanceCents: number }): number {
  return importBalanceGap(() => p.appBalanceCents, rows, p, pairsOf(choices), balance)
}

/** « L'appli compte 210 € de moins que la banque. » */
export function gapWords(gapCents: number): string {
  if (gapCents === 0) return 'Identique à la banque.'
  return `L'appli compte ${euros(gapCents)} de ${gapCents < 0 ? 'moins' : 'plus'} que la banque.`
}

/** A manual entry offered to merge: when, in which category, by whom. */
export function manualText(ctx: MonthContext, id: Id): string {
  const o = ctx.app.operations.find((x) => x.id === id)
  if (!o) return 'Saisie'
  const parts = ctx.app.parts.filter((p) => p.operationId === id)
  const category =
    parts.length > 1 ? 'répartie' : parts[0]?.categoryId === null || parts[0] === undefined ? 'à catégoriser' : path(ctx.ledger, parts[0].categoryId)
  const comment = o.comment ? ` · « ${o.comment} »` : ''
  return `Saisie du ${shortDate(o.valueDate)}, ${category}${comment} · par ${o.createdBy}`
}

export interface GapOperation {
  id: Id
  valueDate: IsoDate
  label: string
  amountCents: number
}

/**
 * Where a gap comes from (spec 3.2): the operations entered since the last check before this
 * one that found no gap, when the balance was last right; all of them if there was none.
 */
export function enteredSince(ctx: MonthContext, checkId: Id): { since: IsoDate | null; operations: GapOperation[] } {
  const checks = [...ctx.app.balanceChecks].sort((a, b) => a.id - b.id)
  const at = checks.findIndex((c) => c.id === checkId)
  const self = checks[at]
  const before = checks.slice(0, Math.max(0, at)).reverse().find((c) => c.gapCents === 0)
  const operations = ctx.app.operations
    .filter((o) => o.archivedAt === null && (!before || o.createdAt > before.createdAt) && (!self || o.createdAt <= self.createdAt))
    .sort((a, b) => (a.valueDate < b.valueDate ? 1 : a.valueDate > b.valueDate ? -1 : b.id - a.id))
    .map((o) => ({ id: o.id, valueDate: o.valueDate, label: o.bankLabel ?? (o.comment ? `Ajout manuel · ${o.comment}` : 'Ajout manuel'), amountCents: o.amountCents }))
  return { since: before ? before.checkDate : null, operations }
}
