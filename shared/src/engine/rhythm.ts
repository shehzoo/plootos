// C1 for one version: the version covers the month and its rhythm falls on it.

import { monthIndex, monthOfYear } from './dates'
import type { BudgetLineVersion, Month, Rhythm } from './model'

export function rhythmFallsOn(rhythm: Rhythm, month: Month): boolean {
  if (rhythm.kind === 'every_n') {
    const delta = monthIndex(month) - monthIndex(rhythm.anchorMonth)
    // Anchor month, anchor + N, anchor + 2N... (C1): never before the anchor.
    return delta >= 0 && delta % rhythm.everyN === 0
  }
  return rhythm.months.includes(monthOfYear(month))
}

export function versionCovers(version: Pick<BudgetLineVersion, 'startMonth' | 'endMonth'>, month: Month): boolean {
  return version.startMonth <= month && (version.endMonth === null || month <= version.endMonth)
}

export function versionApplies(
  version: Pick<BudgetLineVersion, 'startMonth' | 'endMonth' | 'rhythm'>,
  month: Month,
): boolean {
  return versionCovers(version, month) && rhythmFallsOn(version.rhythm, month)
}

/** Checks a rhythm entered by a person; returns an error code, or null when it is valid. */
export function rhythmError(rhythm: Rhythm): 'INVALID_RHYTHM' | null {
  if (rhythm.kind === 'every_n') {
    return Number.isInteger(rhythm.everyN) && rhythm.everyN >= 1 ? null : 'INVALID_RHYTHM'
  }
  const { months } = rhythm
  const valid =
    months.length > 0 &&
    new Set(months).size === months.length &&
    months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)
  return valid ? null : 'INVALID_RHYTHM'
}
