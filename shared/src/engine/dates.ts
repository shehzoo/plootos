// Dates and months. "Today" and the current month follow Paris time, computed the same way in
// the browser and in the Worker, never from the device's own time zone (spec 4.3).

import type { IsoDate, Month } from './model'

const PARIS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's date in Paris, as 'YYYY-MM-DD'. */
export function todayInParis(now: Date = new Date()): IsoDate {
  const parts = PARIS.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** The current month in Paris, as 'YYYY-MM'. */
export function currentMonthInParis(now: Date = new Date()): Month {
  return monthOf(todayInParis(now))
}

export function monthOf(date: IsoDate): Month {
  return date.slice(0, 7)
}

/** Months since year 0: lets months be compared and subtracted as integers. */
export function monthIndex(month: Month): number {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return year * 12 + m - 1
}

export function monthFromIndex(index: number): Month {
  const year = Math.floor(index / 12)
  const m = index - year * 12 + 1
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

export function addMonths(month: Month, count: number): Month {
  return monthFromIndex(monthIndex(month) + count)
}

/** Month of the year, 1 to 12. */
export function monthOfYear(month: Month): number {
  return Number(month.slice(5, 7))
}

export function lastDayOfMonth(month: Month): IsoDate {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${month}-${String(days).padStart(2, '0')}`
}

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/**
 * A date of the bank statement: text 'DD/MM/YYYY', or a date cell read in UTC (spec 4.3).
 * Returns null when the value is not a valid date.
 */
export function parseBankDate(value: string | Date): IsoDate | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(value)
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  return isIsoDate(iso) ? iso : null
}
