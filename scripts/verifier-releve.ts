// Spec 4.9: checks real Crédit Agricole statements with the app's own reader, and prints only
// yes/no answers and counts: never an amount, a label, a name, a date or an account number.
// Run on the computer where the statements are, never in the repository:
//   node verifier-releve.mjs <folder with one or two .xlsx statements>
// With two statements downloaded on different days, it also tells whether the « Solde au » is
// computed in operation date or in value date.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSheet } from 'read-excel-file/node'
import { presenceKey } from '../shared/src/engine/labels'
import { readStatement, type SheetRows, type Statement } from '../shared/src/statement'

const MAX = 100_000
const yes = (b: boolean) => (b ? 'oui' : 'non')
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const kind = (c: unknown) => (c instanceof Date ? 'date' : typeof c === 'string' ? 'texte' : c === null || c === undefined ? 'vide' : 'nombre')

interface Read {
  name: string
  statement: Statement
  downloadSameDay: boolean | null
}

function tally(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].map(([k, n]) => `${k} ${n}`).join(', ')
}

async function check(file: string, index: number): Promise<Read | null> {
  const name = `relevé ${index + 1}`
  let sheet: SheetRows
  try {
    sheet = (await readSheet(readFileSync(file), { parseNumber: (s: string) => s })) as SheetRows
  } catch {
    console.log(`${name} : fichier illisible par la bibliothèque de l'appli`)
    return null
  }
  const read = readStatement(sheet, MAX)
  if ('error' in read) {
    console.log(`${name} : refusé par l'appli, code ${read.error}${read.error === 'bad_row' ? `, ligne ${read.line}` : ''}`)
    return null
  }
  const isValue = (c: unknown) => typeof c === 'string' && /^date\W*valeur$/i.test(c.trim())
  const header = sheet.findIndex((r) => r.some(isValue))
  const dateCol = (sheet[header] ?? []).findIndex((c) => typeof c === 'string' && /^date/i.test(c.trim()) && !isValue(c))
  const valueCol = (sheet[header] ?? []).findIndex(isValue)
  const body = sheet.slice(header + 1).filter((r) => r.some((c) => c !== null && c !== ''))
  const download = sheet.slice(0, header).flat().find((c) => typeof c === 'string' && /^T.l.chargement du \d{2}\/\d{2}\/\d{4}$/.test(c.trim()))
  const downloadIso = typeof download === 'string' ? download.trim().slice(-10).split('/').reverse().join('-') : null
  const balanceRow = sheet.slice(0, header).find((r) => r.some((c) => typeof c === 'string' && /^solde au/i.test(c.trim())))
  const balanceCell = balanceRow ? balanceRow[balanceRow.findIndex((c) => typeof c === 'string' && /^solde au/i.test(c.trim())) + 1] : null
  const st: Statement = read
  const rows = st.rows
  const bal = st.balance.date
  const opDates = rows.map((r) => r.opDate).sort()
  const descending = rows.every((r, i) => i === 0 || (rows[i - 1] as typeof r).opDate >= r.opDate)
  const differ = rows.filter((r) => r.valueDate !== r.opDate)
  const cards = rows.filter((r) => r.bankLabelRaw.toUpperCase().startsWith('PAIEMENT PAR CARTE - '))
  const keys = rows.map((r) => `${r.opDate}|${r.valueDate}|${r.amountCents}|${presenceKey(r.bankLabel)}`)
  const identical = keys.length - new Set(keys).size

  console.log(`${name} : lu par l'appli, ${rows.length} opérations`)
  console.log(`  Jours couverts par les dates d'opération : ${days(opDates[0] as string, opDates[opDates.length - 1] as string) + 1}`)
  console.log(`  Ancienneté de la plus vieille opération au jour du « Solde au » (jours) : ${days(opDates[0] as string, bal)}`)
  console.log(`  « Téléchargement du » trouvé : ${yes(downloadIso !== null)} ; même jour que le « Solde au » : ${downloadIso === null ? '?' : yes(downloadIso === bal)}`)
  console.log(`  Cellule du solde : ${kind(balanceCell)}${typeof balanceCell === 'string' ? ` ; séparateur de milliers : ${yes(/\d[\s  .]\d{3}/.test(balanceCell))}` : ''}`)
  console.log(`  Cellules « Date » : ${tally(body.map((r) => kind(r[dateCol])))} ; « Date valeur » : ${tally(body.map((r) => kind(r[valueCol])))}`)
  console.log(`  Dates d'opération en ordre décroissant : ${yes(descending)}`)
  console.log(`  Date de valeur différente de la date : ${differ.length} ; dont à cheval sur le « Solde au » (date avant ou le jour même, valeur après) : ${differ.filter((r) => r.opDate <= bal && r.valueDate > bal).length}`)
  console.log(`  Date d'opération après le « Solde au » : ${rows.filter((r) => r.opDate > bal).length} ; date de valeur après : ${rows.filter((r) => r.valueDate > bal).length}`)
  console.log(`  Paiements par carte : ${cards.length} ; fragment de carte retiré : ${cards.filter((r) => r.bankLabel !== r.bankLabelRaw.replace(/\s+/g, ' ').trim()).length}`)
  console.log(`  Opérations identiques en double dans le relevé (date, valeur, montant, libellé) : ${identical}`)
  return { name, statement: st, downloadSameDay: downloadIso === null ? null : downloadIso === bal }
}

/** Two statements: the change of balance against the operations between the two dates. */
function convention(a: Read, b: Read): void {
  const [older, newer] = a.statement.balance.date <= b.statement.balance.date ? [a, b] : [b, a]
  const from = older.statement.balance.date
  const to = newer.statement.balance.date
  console.log(`Comparaison : ${days(from, to)} jours entre les deux « Solde au »`)
  if (from === to) return console.log('  Même jour : rien à conclure.')
  const covers = newer.statement.rows.some((r) => r.opDate <= from)
  console.log(`  Le relevé le plus récent couvre la date de l'autre : ${yes(covers)}`)
  if (!covers) return
  const change = newer.statement.balance.balanceCents - older.statement.balance.balanceCents
  const sum = (pick: (r: Statement['rows'][number]) => string) =>
    newer.statement.rows.filter((r) => pick(r) > from && pick(r) <= to).reduce((s, r) => s + r.amountCents, 0)
  const byOp = sum((r) => r.opDate) === change
  const byValue = sum((r) => r.valueDate) === change
  const straddle = newer.statement.rows.filter((r) => r.opDate !== r.valueDate && ((r.opDate <= from) !== (r.valueDate <= from) || (r.opDate <= to) !== (r.valueDate <= to))).length
  console.log(`  Concorde en date d'opération : ${yes(byOp)} ; en date de valeur : ${yes(byValue)}`)
  console.log(`  Opérations à cheval sur l'une des deux dates : ${straddle}${straddle === 0 ? ' (aucune : la comparaison ne tranche pas)' : ''}`)
}

const folder = process.argv[2]
if (!folder) {
  console.log('Usage : node verifier-releve.mjs <dossier>')
  process.exit(1)
}
const files = readdirSync(folder)
  .filter((f) => f.toLowerCase().endsWith('.xlsx'))
  .sort()
  .map((f) => join(folder, f))
console.log(`Relevés XLSX trouvés : ${files.length}`)
const reads: Read[] = []
for (const [i, f] of files.entries()) {
  try {
    const r = await check(f, i)
    if (r) reads.push(r)
  } catch {
    // Fixed text only: an error message could hold a value of the file.
    console.log(`relevé ${i + 1} : erreur inattendue`)
  }
}
if (reads.length === 2) convention(reads[0] as Read, reads[1] as Read)
