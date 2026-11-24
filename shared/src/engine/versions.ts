// R3 (modify a budget line) and R4 (archive it) as pure functions: from the line's versions
// and overrides, they return the changes to write, so that the browser can show them before
// confirmation and the Worker can check and apply the same result (spec 2.2, 4.3).

import { addMonths, isMonth, monthIndex } from './dates'
import type { BudgetLineVersion, BudgetOverride, Id, Month, Rhythm } from './model'
import { rhythmError, versionApplies, versionCovers } from './rhythm'

/** Rhythm entered on a change: an "every N months" rhythm may leave its anchor out (kept, R3). */
export type RhythmInput =
  | { kind: 'every_n'; everyN: number; anchorMonth?: Month }
  | { kind: 'months'; months: number[] }

export interface ModifyLineInput {
  /** All versions of the line, replaced ones included. */
  versions: BudgetLineVersion[]
  /** All overrides of the line, removed ones included. */
  overrides: BudgetOverride[]
  /** First month of the new version: by default the current month, never before (R3). */
  fromMonth: Month
  currentMonth: Month
  categoryId: Id
  amountCents: number
  rhythm: RhythmInput
}

export interface NewVersion {
  categoryId: Id
  amountCents: number
  startMonth: Month
  endMonth: Month | null
  rhythm: Rhythm
}

export interface LineChange {
  /** Versions that stop at an earlier month (the one covering the month before the change, R3; the last month, R4). */
  endVersions: { id: Id; endMonth: Month }[]
  /** Versions marked replaced: they no longer count. */
  replaceVersionIds: Id[]
  /** Overrides still covered, shown as kept on confirmation. */
  keptOverrideIds: Id[]
  /** Overrides marked removed, shown on confirmation. */
  removedOverrideIds: Id[]
}

export interface ModifyLineResult extends LineChange {
  newVersion: NewVersion
  /** First months where the new version applies, shown on confirmation. */
  previewMonths: Month[]
}

export type LineChangeError =
  | 'INVALID_MONTH'
  | 'FROM_MONTH_IN_PAST'
  | 'LAST_MONTH_TOO_EARLY'
  | 'AMOUNT_NOT_POSITIVE'
  | 'INVALID_RHYTHM'
  | 'LINE_ENDED'

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: LineChangeError }

const PREVIEW_COUNT = 6

function activeVersions(versions: BudgetLineVersion[]): BudgetLineVersion[] {
  return versions.filter((v) => v.replacedAt === null).sort((a, b) => (a.startMonth < b.startMonth ? -1 : 1))
}

/** Last month of the line when it is archived, else null (spec 4.5: its last version has an end). */
export function lineEndMonth(versions: BudgetLineVersion[]): Month | null {
  const active = activeVersions(versions)
  const last = active[active.length - 1]
  return last ? last.endMonth : null
}

/** Default month offered by R3: the current month, or the line's start if it starts later. */
export function defaultFromMonth(versions: BudgetLineVersion[], currentMonth: Month): Month {
  const first = activeVersions(versions)[0]
  return first && first.startMonth > currentMonth ? first.startMonth : currentMonth
}

/** Months where a version applies, from a month on (at most `count`). */
export function applicableMonths(
  version: Pick<BudgetLineVersion, 'startMonth' | 'endMonth' | 'rhythm'>,
  from: Month,
  count: number,
): Month[] {
  const months: Month[] = []
  let m = from < version.startMonth ? version.startMonth : from
  // Every rhythm repeats within 12 x N months: bound the search.
  const limit = monthIndex(m) + 12 * Math.max(1, version.rhythm.kind === 'every_n' ? version.rhythm.everyN : 1) * count
  while (months.length < count && monthIndex(m) <= limit) {
    if (version.endMonth !== null && m > version.endMonth) break
    if (versionApplies(version, m)) months.push(m)
    m = addMonths(m, 1)
  }
  return months
}

/** R3: modify a line from a month on. */
export function modifyLine(input: ModifyLineInput): Outcome<ModifyLineResult> {
  const { fromMonth, currentMonth } = input
  if (!isMonth(fromMonth) || !isMonth(currentMonth)) return { ok: false, error: 'INVALID_MONTH' }
  if (fromMonth < currentMonth) return { ok: false, error: 'FROM_MONTH_IN_PAST' }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, error: 'AMOUNT_NOT_POSITIVE' }
  if (input.rhythm.kind === 'every_n' && input.rhythm.anchorMonth !== undefined && !isMonth(input.rhythm.anchorMonth)) {
    return { ok: false, error: 'INVALID_MONTH' }
  }

  const active = activeVersions(input.versions)
  const endMonth = lineEndMonth(input.versions)
  if (endMonth !== null && fromMonth > endMonth) return { ok: false, error: 'LINE_ENDED' }

  const before = addMonths(fromMonth, -1)
  const covering = active.find((v) => versionCovers(v, before)) ?? null
  // The version the anchor is taken from: the one running before the change, else the first one.
  const previous = [...active].reverse().find((v) => v.startMonth < fromMonth) ?? active[0] ?? null

  let rhythm: Rhythm
  if (input.rhythm.kind === 'every_n') {
    const anchorMonth =
      input.rhythm.anchorMonth ??
      (previous && previous.rhythm.kind === 'every_n' ? previous.rhythm.anchorMonth : fromMonth)
    rhythm = { kind: 'every_n', everyN: input.rhythm.everyN, anchorMonth }
  } else {
    rhythm = { kind: 'months', months: [...input.rhythm.months].sort((a, b) => a - b) }
  }
  if (rhythmError(rhythm)) return { ok: false, error: 'INVALID_RHYTHM' }

  const newVersion: NewVersion = {
    categoryId: input.categoryId,
    amountCents: input.amountCents,
    startMonth: fromMonth,
    endMonth,
    rhythm,
  }

  const endVersions = covering && covering.endMonth !== before ? [{ id: covering.id, endMonth: before }] : []
  const replaceVersionIds = active.filter((v) => v.startMonth >= fromMonth).map((v) => v.id)

  const keptOverrideIds: Id[] = []
  const removedOverrideIds: Id[] = []
  for (const o of input.overrides) {
    if (o.removedAt !== null || o.month < fromMonth) continue
    if (versionApplies(newVersion, o.month)) keptOverrideIds.push(o.id)
    else removedOverrideIds.push(o.id)
  }

  return {
    ok: true,
    value: {
      endVersions,
      replaceVersionIds,
      keptOverrideIds,
      removedOverrideIds,
      newVersion,
      previewMonths: applicableMonths(newVersion, fromMonth, PREVIEW_COUNT),
    },
  }
}

export interface ArchiveLineInput {
  versions: BudgetLineVersion[]
  overrides: BudgetOverride[]
  /** Last month where the line counts: at the earliest the month before the current one (R4). */
  lastMonth: Month
  currentMonth: Month
}

/** R4: archive a line, with its last month. */
export function archiveLine(input: ArchiveLineInput): Outcome<LineChange> {
  const { lastMonth, currentMonth } = input
  if (!isMonth(lastMonth) || !isMonth(currentMonth)) return { ok: false, error: 'INVALID_MONTH' }
  if (lastMonth < addMonths(currentMonth, -1)) return { ok: false, error: 'LAST_MONTH_TOO_EARLY' }

  const active = activeVersions(input.versions)
  const endMonth = lineEndMonth(input.versions)
  // Already archived: the last month can only come earlier (no unarchiving in v1).
  if (endMonth !== null && lastMonth >= endMonth) return { ok: false, error: 'LINE_ENDED' }

  const covering = active.find((v) => versionCovers(v, lastMonth)) ?? null
  const endVersions = covering && covering.endMonth !== lastMonth ? [{ id: covering.id, endMonth: lastMonth }] : []
  const replaceVersionIds = active.filter((v) => v.startMonth > lastMonth).map((v) => v.id)

  const keptOverrideIds: Id[] = []
  const removedOverrideIds: Id[] = []
  for (const o of input.overrides) {
    if (o.removedAt !== null || o.month < currentMonth) continue
    if (o.month > lastMonth) removedOverrideIds.push(o.id)
    else keptOverrideIds.push(o.id)
  }
  return { ok: true, value: { endVersions, replaceVersionIds, keptOverrideIds, removedOverrideIds } }
}
