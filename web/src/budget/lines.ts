// Writing budget lines (spec 3.6, lot 8), the part without screens: the choices offered, the
// form of a line, and what R3 and R4 will do, shown before confirmation. The same pure functions
// run in the Worker (shared/src/engine/versions.ts), so what is shown is what gets written.

import {
  addMonths,
  applicableMonths,
  archiveLine,
  defaultFromMonth,
  lineEndMonth,
  modifyLine,
  monthIndex,
  rhythmError,
  rhythmFallsOn,
  type BudgetLineVersion,
  type Id,
  type LineChange,
  type LineChangeError,
  type ModifyLineResult,
  type Month,
  type Rhythm,
  type RhythmInput,
} from '../../../shared/src/engine'
import type { LineChangeRequest, NewLineRequest } from '../../../shared/src/api'
import { euros, monthName, parseEuros } from '../format'
import { monthBounds, type MonthContext } from '../month/view'

// Choices

export interface CategoryChoice {
  id: Id
  /** « Courses » or « Courses > Supermarché » */
  label: string
}

/** Categories one can still choose for a line (R1, R3: level 1 or subcategory, not archived), by section, in their order. */
export function categoryChoices(ctx: MonthContext): { section: string; items: CategoryChoice[] }[] {
  const { app } = ctx
  const byOrder = <T extends { sortOrder: number; id: number }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.id - b.id
  const live = app.categories.filter((c) => c.archivedAt === null).sort(byOrder)
  return app.sections
    .filter((s) => s.archivedAt === null)
    .sort(byOrder)
    .map((s) => ({
      section: s.name,
      items: live
        .filter((c) => c.sectionId === s.id)
        .flatMap((c) => [{ id: c.id, label: c.name }, ...live.filter((x) => x.parentId === c.id).map((x) => ({ id: x.id, label: `${c.name} > ${x.name}` }))]),
    }))
    .filter((g) => g.items.length > 0)
}

/** Months from one to another, both included. */
export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}

/** « juin 2027 » */
export const monthLabel = (m: Month) => `${monthName(m)} ${m.slice(0, 4)}`

/** « juillet, septembre et novembre 2027, puis janvier 2028… »; `more`: other months follow. */
export function monthsText(months: Month[], more: boolean): string {
  if (months.length === 0) return 'aucun mois'
  const years: [string, string[]][] = []
  for (const m of months) {
    const y = m.slice(0, 4)
    const last = years[years.length - 1]
    if (last && last[0] === y) last[1].push(monthName(m))
    else years.push([y, [monthName(m)]])
  }
  const join = (names: string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`)
  const text = years.map(([y, names]) => `${join(names)} ${y}`).join(', puis ')
  return more ? `${text}…` : text
}

/** Ends a text with a full stop, unless it ends with « … ». */
export const sentence = (text: string) => (text.endsWith('…') ? text : `${text}.`)

/** The due months of « tous les N mois » from a first one: « mai, juillet et septembre 2027… ». */
export function dueMonthsText(first: Month, everyN: number): string {
  return monthsText([0, 1, 2].map((k) => addMonths(first, k * everyN)), true)
}

const PREVIEW = 6

/** Months where a version applies from a month on, in words. */
export function previewText(version: Pick<BudgetLineVersion, 'startMonth' | 'endMonth' | 'rhythm'>, from: Month): string {
  if (version.rhythm.kind === 'every_n' && version.rhythm.everyN === 1 && version.endMonth === null) {
    return `tous les mois, à partir de ${monthLabel(from < version.startMonth ? version.startMonth : from)}`
  }
  const months = applicableMonths(version, from, PREVIEW + 1)
  const more = months.length > PREVIEW
  return monthsText(months.slice(0, PREVIEW), more)
}

// The form of a line

export interface LineDraft {
  label: string
  categoryId: Id | null
  /** As typed, in euros. */
  amount: string
  kind: 'every_n' | 'months'
  everyN: string
  months: number[]
  /** First due month picked for « tous les N mois » (calage); null: kept (R3). */
  anchor: Month | null
}

export const emptyDraft = (categoryId: Id | null = null): LineDraft => ({
  label: '',
  categoryId,
  amount: '',
  kind: 'every_n',
  everyN: '1',
  months: [],
  anchor: null,
})

const countedVersions = (ctx: MonthContext, lineId: Id) =>
  ctx.app.versions.filter((v) => v.budgetLineId === lineId && v.replacedAt === null).sort((a, b) => (a.startMonth < b.startMonth ? -1 : 1))

export interface EditableLine {
  id: Id
  label: string
  rowVersion: number
  /** The version a change starts from: in force at the default month of R3. */
  base: BudgetLineVersion
  /** First month offered for a change (R3): the current month, or the line's start if later. */
  defaultFrom: Month
  /** Last month of an archived line, else null. */
  endMonth: Month | null
  /** False once the line no longer counts from the current month on: it is only read. */
  editable: boolean
}

export function editableLine(ctx: MonthContext, lineId: Id): EditableLine | null {
  const line = ctx.app.budgetLines.find((l) => l.id === lineId)
  const versions = countedVersions(ctx, lineId)
  if (!line || versions.length === 0) return null
  const current = monthBounds(ctx).current
  const defaultFrom = defaultFromMonth(versions, current)
  const endMonth = lineEndMonth(versions)
  const base =
    versions.find((v) => v.startMonth <= defaultFrom && (v.endMonth === null || defaultFrom <= v.endMonth)) ?? (versions[versions.length - 1] as BudgetLineVersion)
  return { id: lineId, label: line.label, rowVersion: line.rowVersion, base, defaultFrom, endMonth, editable: endMonth === null || endMonth >= current }
}

export function draftOf(line: EditableLine): LineDraft {
  const r = line.base.rhythm
  return {
    label: line.label,
    categoryId: line.base.categoryId,
    amount: String(line.base.amountCents / 100).replace('.', ','),
    kind: r.kind,
    everyN: r.kind === 'every_n' ? String(r.everyN) : '1',
    months: r.kind === 'months' ? [...r.months] : [],
    anchor: null,
  }
}

/** The rhythm typed, or null when it is not valid (N ≥ 1, at least one month). */
export function draftRhythm(d: LineDraft): RhythmInput | null {
  if (d.kind === 'months') return rhythmError({ kind: 'months', months: d.months }) ? null : { kind: 'months', months: [...d.months].sort((a, b) => a - b) }
  if (!/^\d{1,3}$/.test(d.everyN.trim())) return null
  const everyN = Number(d.everyN.trim())
  if (everyN < 1 || everyN > 120) return null
  return d.anchor === null ? { kind: 'every_n', everyN } : { kind: 'every_n', everyN, anchorMonth: d.anchor }
}

/** Amount typed, in positive cents, or null. */
export function draftAmount(d: LineDraft): number | null {
  const cents = parseEuros(d.amount)
  return cents !== null && cents > 0 ? cents : null
}

/**
 * Anchor of « tous les N mois » as R3 keeps it: the base version's own, or the first month of
 * the change when the base ticks months.
 */
function keptAnchor(line: EditableLine, from: Month): Month {
  return line.base.rhythm.kind === 'every_n' ? line.base.rhythm.anchorMonth : from
}

/**
 * Due months one may pick as the first one (calage, spec 3.6), for N months: the N months from
 * the default month of R3, and the one R3 would keep.
 */
export function anchorChoices(line: EditableLine, everyN: number): { months: Month[]; kept: Month } {
  const months = monthRange(line.defaultFrom, addMonths(line.defaultFrom, everyN - 1))
  const anchor = keptAnchor(line, line.defaultFrom)
  const kept = months.find((m) => rhythmFallsOn({ kind: 'every_n', everyN, anchorMonth: anchor }, m)) ?? (months[0] as Month)
  return { months, kept }
}

export interface DraftState {
  renamed: boolean
  /** Amount, category or rhythm changed: a new version from a month on (R3). */
  changed: boolean
  /** What stops sending: the first field to fix, else null. */
  invalid: string | null
}

const sameRhythm = (a: Rhythm, b: RhythmInput, anchor: Month) => {
  if (a.kind !== b.kind) return false
  if (a.kind === 'months' && b.kind === 'months') return a.months.join(',') === b.months.join(',')
  if (a.kind === 'every_n' && b.kind === 'every_n') {
    if (a.everyN !== b.everyN) return false
    const picked = b.anchorMonth ?? anchor
    return (monthIndex(picked) - monthIndex(a.anchorMonth)) % a.everyN === 0
  }
  return false
}

export function draftState(line: EditableLine, d: LineDraft): DraftState {
  const label = d.label.trim()
  const amount = draftAmount(d)
  const rhythm = draftRhythm(d)
  let invalid: string | null = null
  if (label === '') invalid = 'Le nom est vide.'
  else if (d.categoryId === null) invalid = 'Choisis une catégorie.'
  else if (amount === null) invalid = 'Montant : un nombre positif, en euros.'
  else if (rhythm === null) invalid = d.kind === 'months' ? 'Coche au moins un mois.' : 'Tous les N mois : N entier, 1 ou plus.'
  const changed =
    invalid === null &&
    (d.categoryId !== line.base.categoryId || amount !== line.base.amountCents || !sameRhythm(line.base.rhythm, rhythm as RhythmInput, keptAnchor(line, line.defaultFrom)))
  return { renamed: label !== '' && label !== line.label, changed, invalid }
}

/** The change sent for a draft from a month on; the anchor only when the person picked another due month. */
export function changeRequest(line: EditableLine, d: LineDraft, fromMonth: Month): LineChangeRequest {
  let rhythm = draftRhythm(d) as RhythmInput
  if (rhythm.kind === 'every_n' && rhythm.anchorMonth !== undefined) {
    const kept = keptAnchor(line, fromMonth)
    if (line.base.rhythm.kind === 'every_n' && (monthIndex(rhythm.anchorMonth) - monthIndex(kept)) % rhythm.everyN === 0) {
      rhythm = { kind: 'every_n', everyN: rhythm.everyN }
    }
  }
  return { fromMonth, categoryId: d.categoryId as Id, amountCents: draftAmount(d) as number, rhythm }
}

export interface OverrideNote {
  month: Month
  amountCents: number
}

export interface ChangePreview {
  result: ModifyLineResult
  months: string
  kept: OverrideNote[]
  removed: OverrideNote[]
}

const overrideNotes = (ctx: MonthContext, ids: Id[]): OverrideNote[] =>
  ctx.app.overrides
    .filter((o) => ids.includes(o.id))
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((o) => ({ month: o.month, amountCents: o.amountCents }))

/** R3, before confirmation: the months obtained, and the overrides kept and removed. */
export function previewChange(ctx: MonthContext, line: EditableLine, d: LineDraft, fromMonth: Month): { ok: true; value: ChangePreview } | { ok: false; error: string } {
  const req = changeRequest(line, d, fromMonth)
  const out = modifyLine({
    versions: countedVersions(ctx, line.id),
    overrides: ctx.app.overrides.filter((o) => o.budgetLineId === line.id),
    fromMonth,
    currentMonth: monthBounds(ctx).current,
    categoryId: req.categoryId,
    amountCents: req.amountCents,
    rhythm: req.rhythm,
  })
  if (!out.ok) return { ok: false, error: lineErrorText(out.error.toLowerCase()) }
  const v = out.value
  return {
    ok: true,
    value: { result: v, months: previewText(v.newVersion, fromMonth), kept: overrideNotes(ctx, v.keptOverrideIds), removed: overrideNotes(ctx, v.removedOverrideIds) },
  }
}

/** Months offered for « à partir de »: from the default month of R3 to the line's end, or the end of the projection. */
export function fromChoices(ctx: MonthContext, line: EditableLine): Month[] {
  return monthRange(line.defaultFrom, line.endMonth ?? monthBounds(ctx).last)
}

// Archiving (R4)

/** Last months offered: the previous month at the earliest; before the current end if the line is archived already. */
export function lastMonthChoices(ctx: MonthContext, line: EditableLine): Month[] {
  const { current, last } = monthBounds(ctx)
  const end = line.endMonth === null ? last : addMonths(line.endMonth, -1)
  return monthRange(addMonths(current, -1), end)
}

export function defaultLastMonth(ctx: MonthContext, line: EditableLine): Month {
  const choices = lastMonthChoices(ctx, line)
  const current = monthBounds(ctx).current
  return choices.includes(current) ? current : (choices[choices.length - 1] ?? current)
}

export interface ArchivePreview {
  change: LineChange
  /** « Ne compte plus dès juin 2027. » */
  from: Month
  removed: OverrideNote[]
}

export function previewArchive(ctx: MonthContext, line: EditableLine, lastMonth: Month): { ok: true; value: ArchivePreview } | { ok: false; error: string } {
  const out = archiveLine({
    versions: countedVersions(ctx, line.id),
    overrides: ctx.app.overrides.filter((o) => o.budgetLineId === line.id),
    lastMonth,
    currentMonth: monthBounds(ctx).current,
  })
  if (!out.ok) return { ok: false, error: lineErrorText(out.error.toLowerCase()) }
  return { ok: true, value: { change: out.value, from: addMonths(lastMonth, 1), removed: overrideNotes(ctx, out.value.removedOverrideIds) } }
}

// A new line

/** First months offered to a new line: the current month to the end of the projection. */
export function startChoices(ctx: MonthContext): Month[] {
  const { current, last } = monthBounds(ctx)
  return monthRange(current, last)
}

export function newLineState(d: LineDraft, startMonth: Month): { invalid: string | null; months: string | null } {
  const rhythm = draftRhythm({ ...d, anchor: null })
  let invalid: string | null = null
  if (d.label.trim() === '') invalid = 'Le nom est vide.'
  else if (d.categoryId === null) invalid = 'Choisis une catégorie.'
  else if (draftAmount(d) === null) invalid = 'Montant : un nombre positif, en euros.'
  else if (rhythm === null) invalid = d.kind === 'months' ? 'Coche au moins un mois.' : 'Tous les N mois : N entier, 1 ou plus.'
  if (rhythm === null) return { invalid, months: null }
  // « Tous les N mois » is anchored on the first month (spec 3.6).
  const full: Rhythm = rhythm.kind === 'every_n' ? { kind: 'every_n', everyN: rhythm.everyN, anchorMonth: startMonth } : rhythm
  return { invalid, months: previewText({ startMonth, endMonth: null, rhythm: full }, startMonth) }
}

export function newLineRequest(d: LineDraft, startMonth: Month): NewLineRequest {
  const rhythm = draftRhythm({ ...d, anchor: null }) as RhythmInput
  return {
    label: d.label.trim(),
    categoryId: d.categoryId as Id,
    amountCents: draftAmount(d) as number,
    startMonth,
    rhythm: rhythm.kind === 'every_n' ? { kind: 'every_n', everyN: rhythm.everyN } : rhythm,
  }
}

// Overrides

export interface OverrideTarget {
  lineId: Id
  label: string
  rowVersion: number
  month: Month
  /** Amount of the version that month, without the override. */
  versionCents: number
  /** The override in force that month, if any. */
  current: { amountCents: number; reason: string | null } | null
}

/** A month one can override for a line: current or later, and the line applies (spec 3.6); else null. */
export function overrideTarget(ctx: MonthContext, lineId: Id, month: Month): OverrideTarget | null {
  if (month < monthBounds(ctx).current) return null
  const line = ctx.app.budgetLines.find((l) => l.id === lineId)
  const applied = ctx.ledger.lineInMonth(lineId, month)
  if (!line || !applied) return null
  return {
    lineId,
    label: line.label,
    rowVersion: line.rowVersion,
    month,
    versionCents: applied.version.amountCents,
    current: applied.override ? { amountCents: applied.override.amountCents, reason: applied.override.reason } : null,
  }
}

export const overrideNoteText = (o: OverrideNote) => `${monthLabel(o.month)} (${euros(o.amountCents)})`

/** French text of a refusal about lines and overrides (fixed codes of lines.ts and of the engine). */
export function lineErrorText(code: string): string {
  switch (code as Lowercase<LineChangeError> | string) {
    case 'from_month_in_past':
      return 'Le mois choisi est passé : une modification commence au plus tôt au mois en cours.'
    case 'last_month_too_early':
      return 'Le dernier mois est au plus tôt le mois précédent.'
    case 'line_ended':
      return 'La ligne ne compte plus à ce mois-là.'
    case 'invalid_rhythm':
      return 'Rythme invalide : N entier, 1 ou plus, ou au moins un mois coché.'
    case 'amount_not_positive':
      return 'Le montant doit être positif.'
    case 'invalid_month':
    case 'month_too_far':
      return 'Mois hors de la période suivie.'
    case 'month_in_past':
      return 'Un mois passé ne se surcharge pas.'
    case 'not_applicable':
      return 'La ligne ne s’applique pas ce mois-là.'
    case 'no_override':
      return "Il n'y a plus de surcharge ce mois-là."
    case 'category_archived':
      return 'Cette catégorie est archivée : choisis-en une autre.'
    default:
      return ''
  }
}
