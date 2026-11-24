// Bank labels. One tested function normalizes them (spec 4.4): changing it later means
// migrating the labels already stored, since R8 compares stored labels with new ones.

/** First line of the label, as on the statement: kept as `bank_label_raw`. */
export function firstLine(label: string): string {
  return label.split(/\r\n|\r|\n/, 1)[0] ?? ''
}

/**
 * Normalized label (R8): first line, without the card fragment ("X1234" right after the
 * family, as in "PAIEMENT PAR CARTE - X1234 SHOP 19/03 - TOWN"), spaces collapsed.
 */
export function normalizeBankLabel(label: string): string {
  return firstLine(label)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ - X\d{4} /, ' - ')
}

/**
 * Key of the category suggestion (R11): the normalized label cut at its first DD/MM date,
 * the purchase date of a card payment, so that the same shop on another day, or in another
 * town, suggests the same category. Case is ignored.
 */
export function suggestionKey(normalizedLabel: string): string {
  return normalizedLabel
    .replace(/(^|\s)\d{2}\/\d{2}(\s.*)?$/, '')
    .trim()
    .toUpperCase()
}
