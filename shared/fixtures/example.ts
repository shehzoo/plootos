// Example month of the spec (1.3), March 2027. All amounts are fictitious.
// The operations are those of the fictitious export (same labels, same dates).

import { normalizeBankLabel, firstLine } from '../src/engine/labels'
import type { SeedInput } from './seed'
import type {
  BudgetData,
  BudgetLineVersion,
  BudgetOverride,
  Category,
  Id,
  ImportRow,
  IsoDate,
  Operation,
  OperationPart,
  Rhythm,
  Section,
} from '../src/engine'

export const euros = (amount: number) => Math.round(amount * 100)

export const SECTION = {
  regularIncome: 1,
  oneOffIncome: 2,
  fixed: 3,
  everyday: 4,
  oneOffExpenses: 5,
  savings: 6,
} as const

export const CAT = {
  salaries: 10,
  salaryPerson1: 11,
  salaryPerson2: 12,
  housing: 20,
  energy: 21,
  childcare: 22,
  insurance: 23,
  insuranceCar: 24,
  insuranceHome: 25,
  groceries: 30,
  supermarket: 31,
  butcher: 32,
  cats: 33,
  health: 34,
  pharmacy: 35,
  savingsAccount: 40,
} as const

export const LINE = {
  salaryPerson1: 101,
  salaryPerson2: 102,
  housing: 103,
  groceries: 104,
  cats: 105,
  energy: 106,
  childcare: 107,
  insuranceCar: 108,
  insuranceHome: 109,
  savingsAccount: 110,
} as const

const sections: Section[] = [
  [SECTION.regularIncome, 'Revenus réguliers', 'in'],
  [SECTION.oneOffIncome, 'Revenus ponctuels', 'in'],
  [SECTION.fixed, 'Dépenses fixes', 'out'],
  [SECTION.everyday, 'Dépenses courantes', 'out'],
  [SECTION.oneOffExpenses, 'Dépenses ponctuelles', 'out'],
  [SECTION.savings, 'Épargne', 'out'],
].map(([id, name, direction], i) => ({
  id: id as number,
  name: name as string,
  direction: direction as 'in' | 'out',
  sortOrder: i,
  archivedAt: null,
}))

const cat = (id: Id, name: string, sectionId: Id | null, parentId: Id | null = null): Category => ({
  id,
  name,
  parentId,
  sectionId: parentId === null ? sectionId : null,
  sortOrder: id,
  archivedAt: null,
})

const categories: Category[] = [
  cat(CAT.salaries, 'Salaires', SECTION.regularIncome),
  cat(CAT.salaryPerson1, 'Personne 1', null, CAT.salaries),
  cat(CAT.salaryPerson2, 'Personne 2', null, CAT.salaries),
  cat(CAT.housing, 'Logement', SECTION.fixed),
  cat(CAT.energy, 'Énergie', SECTION.fixed),
  cat(CAT.childcare, 'Garde des enfants', SECTION.fixed),
  cat(CAT.insurance, 'Assurance', SECTION.fixed),
  cat(CAT.insuranceCar, 'Auto', null, CAT.insurance),
  cat(CAT.insuranceHome, 'Maison', null, CAT.insurance),
  cat(CAT.groceries, 'Courses', SECTION.everyday),
  cat(CAT.supermarket, 'Supermarché', null, CAT.groceries),
  cat(CAT.butcher, 'Boucherie', null, CAT.groceries),
  cat(CAT.cats, 'Chats', null, CAT.groceries),
  cat(CAT.health, 'Santé', SECTION.everyday),
  cat(CAT.pharmacy, 'Pharmacie', null, CAT.health),
  cat(CAT.savingsAccount, 'Livret A', SECTION.savings),
]

const monthly = (anchorMonth: string): Rhythm => ({ kind: 'every_n', everyN: 1, anchorMonth })

const lines: [Id, string, Id, number, string, Rhythm][] = [
  [LINE.salaryPerson1, 'Salaire personne 1', CAT.salaryPerson1, 2800, '2027-03', monthly('2027-03')],
  [LINE.salaryPerson2, 'Salaire personne 2', CAT.salaryPerson2, 2200, '2027-03', monthly('2027-03')],
  [LINE.housing, 'Prêt immobilier', CAT.housing, 1200, '2027-03', monthly('2027-03')],
  [LINE.groceries, 'Courses', CAT.groceries, 800, '2027-03', monthly('2027-03')],
  [LINE.cats, 'Chats', CAT.cats, 40, '2027-03', monthly('2027-03')],
  [LINE.energy, 'Énergie', CAT.energy, 150, '2027-03', monthly('2027-03')],
  [LINE.childcare, 'Crèche', CAT.childcare, 400, '2026-09', { kind: 'months', months: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12] }],
  [LINE.insuranceCar, 'Assurance auto', CAT.insuranceCar, 240, '2027-01', { kind: 'every_n', everyN: 3, anchorMonth: '2027-01' }],
  [LINE.insuranceHome, 'Assurance habitation', CAT.insuranceHome, 360, '2027-03', { kind: 'every_n', everyN: 12, anchorMonth: '2027-03' }],
  [LINE.savingsAccount, 'Virement livret A', CAT.savingsAccount, 300, '2027-03', monthly('2027-03')],
]

/** Version id of a line in the example: line id + 100. */
export const versionId = (lineId: Id) => lineId + 100

const versions: BudgetLineVersion[] = lines.map(([lineId, , categoryId, amount, startMonth, rhythm]) => ({
  id: versionId(lineId),
  budgetLineId: lineId,
  categoryId,
  amountCents: euros(amount),
  startMonth,
  endMonth: null,
  replacedAt: null,
  rhythm,
}))

const overrides: BudgetOverride[] = [
  { id: 301, budgetLineId: LINE.groceries, month: '2027-03', amountCents: euros(950), reason: 'Anniversaire', removedAt: null },
]

/** The fictitious export, as read: date, value date, label, debit, credit (most recent first). */
export const EXPORT: [string, string, string, number | null, number | null][] = [
  ['31/03/2027', '01/04/2027', 'PAIEMENT PAR CARTE - X0000 SUPERMARCHE EXEMPLE 31/03 - VILLE EXEMPLE', 230, null],
  ['29/03/2027', '29/03/2027', 'VIREMENT EN VOTRE FAVEUR - CPAM EXEMPLE REMBOURSEMENT\nREF000000000000', null, 20],
  ['28/03/2027', '28/03/2027', 'PAIEMENT PAR CARTE - X0000 PHARMACIE EXEMPLE 28/03 - VILLE EXEMPLE', 35, null],
  ['25/03/2027', '25/03/2027', 'VIREMENT EMIS - VERS LIVRET A EXEMPLE\nREF000000000000', 300, null],
  ['22/03/2027', '22/03/2027', 'PRELEVEMENT - ASSUREUR EXEMPLE - ASSURANCE HABITATION\n000000AAA00000000A000000000\nFR00ZZZ000000\nRUM-EXEMPLE0000000000', 372, null],
  ['20/03/2027', '20/03/2027', 'PAIEMENT PAR CARTE - X0000 SUPERMARCHE EXEMPLE 19/03 - VILLE EXEMPLE', 260, null],
  ['15/03/2027', '15/03/2027', 'VIREMENT EMIS - CRECHE EXEMPLE MARS\nREF000000000000', 400, null],
  ['15/03/2027', '15/03/2027', 'PRELEVEMENT - ENERGIE EXEMPLE - FACTURE MENSUELLE\n000000AAA00000000A000000000\nFR00ZZZ000000', 150, null],
  ['12/03/2027', '12/03/2027', 'PAIEMENT PAR CARTE - X0000 BOUCHERIE EXEMPLE 11/03 - VILLE EXEMPLE', 95, null],
  ['06/03/2027', '06/03/2027', 'PAIEMENT PAR CARTE - X0000 SUPERMARCHE EXEMPLE 05/03 - VILLE EXEMPLE', 210, null],
  ['05/03/2027', '05/03/2027', 'PRELEVEMENT - BANQUE EXEMPLE - ECHEANCE PRET\n000000AAA00000000A000000000\nFR00ZZZ000000', 1200, null],
  ['01/03/2027', '01/03/2027', 'VIREMENT EN VOTRE FAVEUR - EMPLOYEUR B EXEMPLE SALAIRE\nREF000000000000', null, 2200],
  ['01/03/2027', '01/03/2027', 'VIREMENT EN VOTRE FAVEUR - EMPLOYEUR A EXEMPLE SALAIRE\nREF000000000000', null, 2800],
]

/** Statement balance of the fictitious export. */
export const STATEMENT = { date: '2027-04-02', balanceCents: euros(4768) }

const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`

/** Rows of the fictitious export, as the browser sends them (spec 4.4, step 2). */
export function exportRows(): ImportRow[] {
  return EXPORT.map(([date, valueDate, label, debit, credit]) => ({
    opDate: iso(date),
    valueDate: iso(valueDate),
    amountCents: euros((credit ?? 0) - (debit ?? 0)),
    bankLabel: normalizeBankLabel(label),
    bankLabelRaw: firstLine(label),
  }))
}

/** Categorization of the example, in chronological order of the export (spec 1.3). */
const CATEGORIZATION: [number, Id][][] = [
  [[2800, CAT.salaryPerson1]],
  [[2200, CAT.salaryPerson2]],
  [[-1200, CAT.housing]],
  [[-210, CAT.supermarket]],
  [[-95, CAT.butcher]],
  [[-150, CAT.energy]],
  [[-400, CAT.childcare]],
  [[-215, CAT.supermarket], [-45, CAT.cats]],
  [[-372, CAT.insuranceHome]],
  [[-300, CAT.savingsAccount]],
  [[-35, CAT.pharmacy]],
  [[20, CAT.pharmacy]],
  [[-230, CAT.supermarket]],
]

/** Imported and categorized operations of the example, ids 1 to 13 by value date. */
function exampleOperations(): { operations: Operation[]; parts: OperationPart[] } {
  const rows = exportRows().reverse()
  const operations: Operation[] = []
  const parts: OperationPart[] = []
  rows.forEach((row, i) => {
    const id = i + 1
    operations.push({
      id,
      ...row,
      origin: 'import',
      dupRank: 1,
      comment: null,
      archivedAt: null,
    })
    for (const [amount, categoryId] of CATEGORIZATION[i] ?? []) {
      parts.push({ id: id * 10 + parts.filter((p) => p.operationId === id).length, operationId: id, categoryId, amountCents: euros(amount) })
    }
  })
  return { operations, parts }
}

export interface ExampleOptions {
  /** Keep only the operations valued on or before this date (what is entered at that point). */
  enteredUpTo?: IsoDate
  /** Leave the operations out. */
  withoutOperations?: boolean
}

export function exampleData(options: ExampleOptions = {}): BudgetData {
  let { operations, parts } = exampleOperations()
  if (options.withoutOperations) {
    operations = []
    parts = []
  } else if (options.enteredUpTo) {
    const upTo = options.enteredUpTo
    operations = operations.filter((o) => o.valueDate <= upTo)
    const ids = new Set(operations.map((o) => o.id))
    parts = parts.filter((p) => ids.has(p.operationId))
  }
  return structuredClone({
    sections,
    categories,
    budgetLines: lines.map(([id, label]) => ({ id, label })),
    versions,
    overrides,
    operations,
    parts,
    openingBalance: { balanceDate: '2027-02-28', amountCents: euros(3000) },
  })
}

/** Who categorized each operation (spec 1.3), ids 1 to 13: 0 is person 1, 1 is person 2. */
const CATEGORIZED_BY: (0 | 1)[] = [0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1]

/** Balance check of the data set "exemple-15-03": 12/03, the bank and the app agree. */
const CHECK_MARCH_12 = { id: 1, checkDate: '2027-03-12', bankBalanceCents: euros(6495), gapCents: 0 }

/**
 * The example month as a data set (spec 1.3), with its authors: person 1 sets up the budget
 * and imports; each operation is categorized by the person of the spec; person 2 sets the
 * Courses override. Whole month: one balance check at the statement date, no gap. Entered up
 * to a date (data set "exemple-15-03"): the operations valued up to that date, and one check
 * on 12/03, no gap.
 */
export function exampleSeedInput(options: Pick<ExampleOptions, 'enteredUpTo'> = {}): SeedInput {
  const data = exampleData(options)
  const balanceChecks = options.enteredUpTo
    ? [CHECK_MARCH_12].filter((c) => c.checkDate <= (options.enteredUpTo as IsoDate))
    : [{ id: 1, checkDate: STATEMENT.date, bankBalanceCents: STATEMENT.balanceCents, gapCents: 0 }]
  return {
    data,
    balanceChecks,
    authorship: (table, id) => {
      const setup = '2027-02-28T19:00:00.000Z'
      if (table === 'operation' || table === 'operation_part') {
        const opId = table === 'operation' ? id : (data.parts.find((p) => p.id === id)?.operationId ?? 1)
        const op = data.operations.find((o) => o.id === opId)
        const at = `${op?.opDate ?? '2027-03-01'}T20:00:00.000Z`
        return { createdBy: 0, createdAt: at, updatedBy: CATEGORIZED_BY[opId - 1] ?? 0, updatedAt: at }
      }
      if (table === 'budget_override') {
        return { createdBy: 1, createdAt: '2027-03-02T19:00:00.000Z', updatedBy: 1, updatedAt: '2027-03-02T19:00:00.000Z' }
      }
      if (table === 'balance_check') {
        const at = `${balanceChecks.find((c) => c.id === id)?.checkDate ?? STATEMENT.date}T21:00:00.000Z`
        return { createdBy: 0, createdAt: at, updatedBy: 0, updatedAt: at }
      }
      return { createdBy: 0, createdAt: setup, updatedBy: 0, updatedAt: setup }
    },
  }
}

/** The May operation of case B (spec 1.4): -150 € valued 15/05/2027, categorized Énergie. */
export const CASE_B_OPERATION = { id: 14, valueDate: '2027-05-15', amountCents: euros(-150) }

/**
 * Data set "cas-a-b": the example month, plus the operation of case B, entered by hand and
 * categorized Énergie (manual entry and categorization only arrive in lot 9). The rest of cases A
 * and B is played through the app, with a simulated date (DECISIONS.md, 2026-11-25).
 */
export function casesABSeedInput(): SeedInput {
  const input = exampleSeedInput()
  const { id, valueDate, amountCents } = CASE_B_OPERATION
  input.data.operations.push({
    id,
    opDate: valueDate,
    valueDate,
    amountCents,
    origin: 'manual',
    bankLabel: null,
    bankLabelRaw: null,
    dupRank: null,
    comment: null,
    archivedAt: null,
  })
  input.data.parts.push({ id: id * 10, operationId: id, categoryId: CAT.energy, amountCents })
  return input
}
