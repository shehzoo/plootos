// Lot 9, pure functions of the screens that write operations (spec 3.2, 3.3): the category
// field, the manual entry, the record of an operation, the operations to categorize. Tested
// in web/test/lot9.test.ts.

import {
  absorbInFirstPart,
  duplicateOf,
  manualDateError,
  monthOf,
  partsError,
  type Id,
  type IsoDate,
  type Month,
  type Operation,
  type PartInput,
} from '../../../shared/src/engine'
import { euros, fullDate, parseEuros, signedEuros } from '../format'
import { isUncategorized, path, type MonthContext } from '../month/view'

// Category field: the categories where a part can go (R2), searched by a few letters.

export interface CategoryChoice {
  id: Id
  /** « Courses > Chats » */
  label: string
  /** Lower case, no accents: what is searched. */
  key: string
}

/** Lower case, accents removed: « Énergie » and « energie » match. */
export const searchKey = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

const byOrder = <T extends { sortOrder: number; id: number }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.id - b.id

/** Categories that can be chosen now (R2: finest level, not archived), in the order of the app. */
export function categoryChoices(ctx: MonthContext): CategoryChoice[] {
  const { ledger, app } = ctx
  const live = app.categories.filter((c) => c.archivedAt === null).sort(byOrder)
  const out: CategoryChoice[] = []
  for (const s of [...app.sections].filter((x) => x.archivedAt === null).sort(byOrder)) {
    for (const c of live.filter((x) => x.sectionId === s.id)) {
      for (const id of [c.id, ...live.filter((x) => x.parentId === c.id).map((x) => x.id)]) {
        if (!ledger.isChoosable(id)) continue
        const label = path(ledger, id)
        out.push({ id, label, key: searchKey(label) })
      }
    }
  }
  return out
}

/** Choices matching what was typed: « cha » finds Courses > Chats; names starting with it first. */
export function matchCategories(choices: CategoryChoice[], text: string): CategoryChoice[] {
  const q = searchKey(text)
  if (q === '') return choices
  const words = q.split(' ').filter((w) => w !== '' && w !== '>')
  const hits = choices.filter((c) => words.every((w) => c.key.includes(w)))
  const starts = (c: CategoryChoice) => c.key.split(/ > /).some((part) => part.startsWith(words[0] ?? ''))
  return [...hits.filter(starts), ...hits.filter((c) => !starts(c))]
}

/** The choice whose label is exactly what was typed (case and accents ignored), if any. */
export function exactCategory(choices: CategoryChoice[], text: string): CategoryChoice | null {
  const q = searchKey(text)
  return choices.find((c) => c.key === q) ?? null
}

/** Label of a category that may no longer be choosable (« Courses (sans détail) »). */
export function categoryLabel(ctx: MonthContext, id: Id): string {
  const c = ctx.ledger.category(id)
  const label = path(ctx.ledger, id)
  return c.parentId === null && ctx.ledger.children(id).some((x) => x.archivedAt === null) ? `${label} (sans détail)` : label
}

// Manual entry (spec 3.2): one row per operation.

export interface EntryRow {
  /** As typed. On a computer « +50 » is money in, anything else money out. */
  amount: string
  /** Phone: the Sortie / Entrée switch (its keypad has no « + »). */
  direction: 'out' | 'in'
  valueDate: IsoDate
  categoryId: Id | null
  comment: string
}

export const emptyRow = (valueDate: IsoDate): EntryRow => ({ amount: '', direction: 'out', valueDate, categoryId: null, comment: '' })

/**
 * Signed cents of a row, or null. A computer types « + » for money in (decision of 2026-11-23);
 * a phone uses the switch. A typed « - » is money out either way.
 */
export function rowCents(row: EntryRow, phone: boolean): number | null {
  const text = row.amount.trim()
  const plus = text.startsWith('+')
  const cents = parseEuros(plus ? text.slice(1) : text)
  if (cents === null || cents === 0) return null
  const abs = Math.abs(cents)
  if (cents < 0) return -abs
  if (phone) return row.direction === 'in' ? abs : -abs
  return plus ? abs : -abs
}

/** Something was typed in the row. */
export const isFilled = (row: EntryRow) => row.amount.trim() !== '' || row.comment.trim() !== '' || row.categoryId !== null

export interface RowCheck {
  cents: number | null
  /** What blocks the row: no amount, a refused date. */
  error: string | null
  /** R5: same amount and value date as an operation already there, or as an earlier row. */
  duplicate: string | null
}

function operationName(ctx: MonthContext, o: Operation): string {
  if (o.bankLabel) return o.bankLabel
  const parts = ctx.ledger.partsOf(o.id)
  const only = parts.length === 1 ? parts[0] : undefined
  if (o.comment) return o.comment
  if (only && only.categoryId !== null) return `ajout manuel, ${path(ctx.ledger, only.categoryId)}`
  return 'ajout manuel'
}

/** The checks of each row, as shown under it. */
export function checkRows(ctx: MonthContext, rows: EntryRow[], phone: boolean): RowCheck[] {
  const opening = ctx.ledger.data.openingBalance.balanceDate
  const cents = rows.map((r) => rowCents(r, phone))
  return rows.map((row, i) => {
    const c = cents[i] ?? null
    let error: string | null = null
    if (isFilled(row) && c === null) error = row.amount.trim() === '' ? 'Montant manquant.' : 'Montant : un nombre en euros, pas 0.'
    const dateError = /^\d{4}-\d{2}-\d{2}$/.test(row.valueDate) ? manualDateError(row.valueDate, opening, ctx.today) : 'value_date_too_early'
    if (isFilled(row) && dateError) {
      error =
        dateError === 'value_date_too_early' && /^\d{4}-\d{2}-\d{2}$/.test(row.valueDate)
          ? `Date de valeur : après le ${fullDate(opening)}, date du solde initial.`
          : dateError === 'value_date_too_far'
            ? 'Date de valeur trop lointaine.'
            : 'Date de valeur manquante.'
    }
    let duplicate: string | null = null
    if (c !== null && !dateError) {
      const there = duplicateOf(ctx.ledger.data.operations, row.valueDate, c)
      if (there) duplicate = `Même montant et même date de valeur que « ${operationName(ctx, there)} », déjà dans l'appli.`
      else {
        const j = rows.findIndex((r, k) => k < i && cents[k] === c && r.valueDate === row.valueDate)
        if (j >= 0) duplicate = `Même montant et même date de valeur que ${phone ? `l'opération ${j + 1}` : `la ligne ${j + 1}`}.`
      }
    }
    return { cents: c, error, duplicate }
  })
}

/** Rows to send: filled ones; all must be valid. */
export function readyRows(rows: EntryRow[], checks: RowCheck[]): { count: number; totalCents: number; blocked: boolean } {
  let count = 0
  let totalCents = 0
  let blocked = false
  rows.forEach((r, i) => {
    if (!isFilled(r)) return
    const c = checks[i]
    if (!c || c.error || c.cents === null) blocked = true
    else {
      count++
      totalCents += c.cents
    }
  })
  return { count, totalCents, blocked }
}

/** « 3 opérations · −305 € » */
export const totalText = (count: number, totalCents: number) => (count === 0 ? '' : `${count} opération${count > 1 ? 's' : ''} · ${signedEuros(totalCents)}`)

// Split (spec 3.3): parts typed as positive euros, the sign is the operation's.

export interface PartDraft {
  categoryId: Id | null
  /** Euros, positive, as typed. */
  amount: string
}

export const centsText = (cents: number) => (Math.abs(cents) / 100).toFixed(2).replace('.', ',').replace(/,00$/, '')

/** The parts of a split as written, or null if one is not a positive amount. */
export function splitParts(drafts: PartDraft[], amountCents: number): PartInput[] | null {
  const sign = amountCents < 0 ? -1 : 1
  const out: PartInput[] = []
  for (const d of drafts) {
    const c = parseEuros(d.amount)
    if (c === null || c <= 0) return null
    out.push({ categoryId: d.categoryId, amountCents: sign * c })
  }
  return out
}

/** The first part takes what the others leave (spec 3.3). */
export function fillFirst(drafts: PartDraft[], amountCents: number): PartDraft[] {
  const others = drafts.slice(1).reduce((sum, d) => sum + Math.max(0, parseEuros(d.amount) ?? 0), 0)
  const first = drafts[0]
  if (!first) return drafts
  return [{ ...first, amount: centsText(Math.abs(amountCents) - others) }, ...drafts.slice(1)]
}

/** « Reste à répartir : 10 € », « Tout est réparti », or what is missing. */
export function splitStatus(drafts: PartDraft[], amountCents: number): { ok: boolean; text: string } {
  const sum = drafts.reduce((s, d) => s + (parseEuros(d.amount) ?? 0), 0)
  const rest = Math.abs(amountCents) - sum
  if (rest !== 0) return { ok: false, text: rest > 0 ? `Reste à répartir : ${euros(rest)}` : `Réparti en trop : ${euros(-rest)}` }
  if (drafts.some((d) => d.categoryId === null)) return { ok: false, text: 'Chaque part a une catégorie.' }
  const parts = splitParts(drafts, amountCents)
  if (!parts) return { ok: false, text: 'Chaque part a un montant de plus de 0 €.' }
  return { ok: true, text: drafts.length > 1 ? 'Tout est réparti' : 'Une seule catégorie : l’opération ne sera plus répartie' }
}

// Record of an operation (spec 3.2), on a computer.

export interface RecordDraft {
  amount: string
  valueDate: IsoDate
  comment: string
  /** The parts as they will be written; the first takes the difference when the amount changes. */
  parts: PartInput[]
  /** The single category is the suggestion of R11, not yet changed. */
  suggested: boolean
}

export function recordDraft(ctx: MonthContext, o: Operation): RecordDraft {
  const parts = ctx.ledger.partsOf(o.id).map((p) => ({ categoryId: p.categoryId, amountCents: p.amountCents }))
  let suggested = false
  if (parts.length === 1 && parts[0]?.categoryId === null) {
    const s = ctx.ledger.suggestCategory(o.bankLabel)
    if (s !== null) {
      parts[0] = { categoryId: s, amountCents: o.amountCents }
      suggested = true
    }
  }
  return { amount: centsText(o.amountCents), valueDate: o.valueDate, comment: o.comment ?? '', parts, suggested }
}

/** Signed amount of the record: a manual entry keeps the sign it has unless « + » or « - » is typed. */
export function draftCents(draft: RecordDraft, o: Operation): number | null {
  if (o.origin !== 'manual') return o.amountCents
  const text = draft.amount.trim()
  const cents = parseEuros(text.startsWith('+') ? text.slice(1) : text)
  if (cents === null || cents === 0) return null
  if (text.startsWith('+')) return Math.abs(cents)
  if (text.startsWith('-') || text.startsWith('−')) return -Math.abs(cents)
  return o.amountCents < 0 ? -Math.abs(cents) : Math.abs(cents)
}

export interface RecordChange {
  body: { comment?: string | null; parts?: PartInput[]; amountCents?: number; valueDate?: IsoDate }
  /** Parts once the first one takes the difference. */
  parts: PartInput[]
  error: string | null
  /** R5, when the amount or the value date changes. */
  duplicate: string | null
  changed: boolean
}

const sameParts = (a: PartInput[], b: PartInput[]) =>
  a.length === b.length && a.every((p, i) => p.categoryId === b[i]?.categoryId && p.amountCents === b[i]?.amountCents)

/** What « Enregistrer » sends, and what blocks it. */
export function recordChange(ctx: MonthContext, o: Operation, draft: RecordDraft): RecordChange {
  const stored = ctx.ledger.partsOf(o.id).map((p) => ({ categoryId: p.categoryId, amountCents: p.amountCents }))
  const body: RecordChange['body'] = {}
  const cents = draftCents(draft, o)
  if (cents === null) return { body, parts: draft.parts, error: 'Montant : un nombre en euros, pas 0.', duplicate: null, changed: true }
  const parts = cents === draft.parts.reduce((s, p) => s + p.amountCents, 0) ? draft.parts : absorbInFirstPart(draft.parts, cents)
  let error: string | null = null
  const partsErr = partsError(parts, cents)
  if (partsErr === 'part_sign') error = 'La première part deviendrait nulle ou de l’autre signe : modifie la répartition.'
  else if (partsErr) error = 'La répartition ne tombe pas juste.'
  if (o.origin === 'manual') {
    if (cents !== o.amountCents) body.amountCents = cents
    if (draft.valueDate !== o.valueDate) {
      body.valueDate = draft.valueDate
      const refused = manualDateError(draft.valueDate, ctx.ledger.data.openingBalance.balanceDate, ctx.today)
      if (refused === 'value_date_too_early')
        error = `Date de valeur : après le ${fullDate(ctx.ledger.data.openingBalance.balanceDate)}, date du solde initial.`
      else if (refused) error = 'Date de valeur trop lointaine.'
    }
  }
  if (!sameParts(parts, stored)) body.parts = parts
  const comment = draft.comment.trim() === '' ? null : draft.comment.trim()
  if (comment !== (o.comment ?? null)) body.comment = comment
  let duplicate: string | null = null
  if (body.amountCents !== undefined || body.valueDate !== undefined) {
    const there = duplicateOf(ctx.ledger.data.operations, draft.valueDate, cents, o.id)
    if (there) duplicate = `Même montant et même date de valeur que « ${operationName(ctx, there)} », déjà dans l'appli.`
  }
  return { body, parts, error, duplicate, changed: Object.keys(body).length > 0 }
}

// Catégoriser (spec 3.3): every operation to categorize, whatever its month.

export interface TodoRow {
  id: Id
  rowVersion: number
  valueDate: IsoDate
  label: string
  amountCents: number
  comment: string | null
  /** R11: the category of the latest operation with the same bank label, if any. */
  suggestion: Id | null
}

export function todoGroups(ctx: MonthContext): { month: Month; rows: TodoRow[] }[] {
  const { ledger, app } = ctx
  const opening = ledger.data.openingBalance.balanceDate
  const version = new Map(app.operations.map((o) => [o.id, o.rowVersion]))
  const ops = ledger.data.operations
    .filter((o) => o.archivedAt === null && o.valueDate > opening && isUncategorized(ledger, o))
    .sort((a, b) => (a.valueDate < b.valueDate ? -1 : a.valueDate > b.valueDate ? 1 : a.id - b.id))
  const groups: { month: Month; rows: TodoRow[] }[] = []
  for (const o of ops) {
    const month = monthOf(o.valueDate)
    let g = groups[groups.length - 1]
    if (!g || g.month !== month) {
      g = { month, rows: [] }
      groups.push(g)
    }
    // A split operation with a part still to categorize is not offered a single category.
    const split = ledger.partsOf(o.id).length > 1
    g.rows.push({
      id: o.id,
      rowVersion: version.get(o.id) ?? 1,
      valueDate: o.valueDate,
      label: o.bankLabel ?? (o.origin === 'manual' ? 'Ajout manuel' : ''),
      amountCents: o.amountCents,
      comment: o.comment,
      suggestion: split ? null : ledger.suggestCategory(o.bankLabel),
    })
  }
  return groups
}

/** Operations to categorize, all months (the « Catégoriser » button shows when there are some). */
export const todoCount = (ctx: MonthContext) => todoGroups(ctx).reduce((n, g) => n + g.rows.length, 0)
