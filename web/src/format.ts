// Writing of numbers and dates (DESIGN.md, « Écriture des nombres »): euros without decimals
// when they are zero, a narrow no-break space between thousands, a no-break space before « € ».

import type { IsoDate, Month } from '../../shared/src/engine'

const WHOLE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const CENTS = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const MINUS = '−'
const NBSP = ' '

/** Unsigned amount: the meaning is in the column or the words (« 1 200 € », « 42,50 € »). */
export function euros(cents: number): string {
  const abs = Math.abs(cents)
  const text = abs % 100 === 0 ? WHOLE.format(abs / 100) : CENTS.format(abs / 100)
  return `${text}${NBSP}€`
}

/** Amount whose sign is visible only when negative (a balance, a refund larger than the spending). */
export function eurosOrMinus(cents: number): string {
  return cents < 0 ? `${MINUS}${euros(cents)}` : euros(cents)
}

/** Signed amount, as in a list of operations: « −260 € », « +20 € », « 0 € ». */
export function signedEuros(cents: number): string {
  if (cents > 0) return `+${euros(cents)}`
  if (cents < 0) return `${MINUS}${euros(cents)}`
  return euros(0)
}

/** French plural of a quantity of euros: singular below 2 € (« 1,50 € dépensé »). */
export function eurosArePlural(cents: number): boolean {
  return Math.abs(cents) >= 200
}

export const MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const

/** « mars » */
export function monthName(month: Month): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] as string
}

/** « Mars 2027 » */
export function monthTitle(month: Month): string {
  const name = monthName(month)
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`
}

/** « 12/03 » */
export function shortDate(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/** « 12/03/2027 » */
export function fullDate(date: IsoDate): string {
  return `${shortDate(date)}/${date.slice(0, 4)}`
}

/** « 1 opération », « 3 opérations » */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n}${NBSP}${n > 1 ? plural : singular}`
}

/** Amount without the euro sign, for a grid of twelve months (« 1 200 »). */
export function plainEuros(cents: number): string {
  const abs = Math.abs(cents)
  return abs % 100 === 0 ? WHOLE.format(abs / 100) : CENTS.format(abs / 100)
}

/** Signed amount without the euro sign: « +1 870 », « −90 », « 0 ». */
export function signedPlainEuros(cents: number): string {
  if (cents > 0) return `+${plainEuros(cents)}`
  if (cents < 0) return `${MINUS}${plainEuros(cents)}`
  return '0'
}
