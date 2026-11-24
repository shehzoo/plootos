// Several years of fictitious data, to measure loading and calculation (lot 3 criterion:
// 3 years, about 170 operations a month, spec 4.3). Deterministic: the same options always
// give the same data. All names, labels and amounts are invented.

import { addMonths, lastDayOfMonth, monthOfYear } from '../src/engine/dates'
import { firstLine, normalizeBankLabel } from '../src/engine/labels'
import { Ledger } from '../src/engine/ledger'
import type {
  BudgetData,
  BudgetLine,
  BudgetLineVersion,
  BudgetOverride,
  Category,
  Id,
  IsoDate,
  Month,
  Operation,
  OperationPart,
  Rhythm,
  Section,
} from '../src/engine/model'
import { versionApplies } from '../src/engine/rhythm'
import type { Authorship, SeedBalanceCheck, SeedInput } from './seed'

export interface GeneratorOptions {
  /** Last month of data, which is also the month "in progress" (some operations to categorize). */
  endMonth?: Month
  /** Number of months of data. */
  months?: number
  seed?: number
}

/** Small deterministic random generator (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    between: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    chance: (p: number) => next() < p,
  }
}

const S = { regularIncome: 1, oneOffIncome: 2, fixed: 3, everyday: 4, oneOff: 5, savings: 6 }

const SECTIONS: Section[] = [
  [S.regularIncome, 'Revenus réguliers', 'in'],
  [S.oneOffIncome, 'Revenus ponctuels', 'in'],
  [S.fixed, 'Dépenses fixes', 'out'],
  [S.everyday, 'Dépenses courantes', 'out'],
  [S.oneOff, 'Dépenses ponctuelles', 'out'],
  [S.savings, 'Épargne', 'out'],
].map(([id, name, direction], i) => ({
  id: id as number,
  name: name as string,
  direction: direction as 'in' | 'out',
  sortOrder: i,
  archivedAt: null,
}))

export const C = {
  salaries: 10,
  salary1: 11,
  salary2: 12,
  refunds: 13,
  housing: 20,
  energy: 21,
  childcare: 22,
  insurance: 23,
  insuranceCar: 24,
  insuranceHome: 25,
  phone: 26,
  taxes: 27,
  groceries: 30,
  supermarket: 31,
  butcher: 32,
  cats: 33,
  health: 34,
  pharmacy: 35,
  doctor: 36,
  transport: 37,
  fuel: 38,
  tolls: 39,
  savingsAccount: 40,
  restaurants: 41,
  leisure: 42,
  clothes: 43,
  children: 44,
  activities: 45,
  gifts: 50,
  holidays: 51,
  homeEquipment: 52,
} as const

const CATEGORIES: [Id, string, Id | null, Id | null][] = [
  [C.salaries, 'Salaires', S.regularIncome, null],
  [C.salary1, 'Personne 1', null, C.salaries],
  [C.salary2, 'Personne 2', null, C.salaries],
  [C.refunds, 'Remboursements', S.oneOffIncome, null],
  [C.housing, 'Logement', S.fixed, null],
  [C.energy, 'Énergie', S.fixed, null],
  [C.childcare, 'Garde des enfants', S.fixed, null],
  [C.insurance, 'Assurance', S.fixed, null],
  [C.insuranceCar, 'Auto', null, C.insurance],
  [C.insuranceHome, 'Maison', null, C.insurance],
  [C.phone, 'Téléphone et internet', S.fixed, null],
  [C.taxes, 'Impôts', S.fixed, null],
  [C.groceries, 'Courses', S.everyday, null],
  [C.supermarket, 'Supermarché', null, C.groceries],
  [C.butcher, 'Boucherie', null, C.groceries],
  [C.cats, 'Chats', null, C.groceries],
  [C.health, 'Santé', S.everyday, null],
  [C.pharmacy, 'Pharmacie', null, C.health],
  [C.doctor, 'Médecin', null, C.health],
  [C.transport, 'Transport', S.everyday, null],
  [C.fuel, 'Carburant', null, C.transport],
  [C.tolls, 'Péage et parking', null, C.transport],
  [C.restaurants, 'Restaurants', S.everyday, null],
  [C.leisure, 'Loisirs', S.everyday, null],
  [C.clothes, 'Vêtements', S.everyday, null],
  [C.children, 'Enfants', S.everyday, null],
  [C.activities, 'Activités', null, C.children],
  [C.gifts, 'Cadeaux', S.oneOff, null],
  [C.holidays, 'Vacances', S.oneOff, null],
  [C.homeEquipment, 'Équipement maison', S.oneOff, null],
  [C.savingsAccount, 'Livret A', S.savings, null],
]

const SCHOOL_MONTHS = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12]
const monthly = (anchorMonth: Month): Rhythm => ({ kind: 'every_n', everyN: 1, anchorMonth })
const ticked = (months: number[]): Rhythm => ({ kind: 'months', months })

/** Card shops: category, average count a month, amount range in euros, label. */
const SHOPS: [Id, number, number, number, string][] = [
  [C.supermarket, 40, 15, 140, 'SUPERMARCHE EXEMPLE'],
  [C.supermarket, 15, 3, 25, 'EPICERIE EXEMPLE'],
  [C.supermarket, 35, 2, 12, 'BOULANGERIE EXEMPLE'],
  [C.butcher, 5, 20, 60, 'BOUCHERIE EXEMPLE'],
  [C.cats, 2, 15, 40, 'ANIMALERIE EXEMPLE'],
  [C.pharmacy, 5, 5, 45, 'PHARMACIE EXEMPLE'],
  [C.doctor, 2, 25, 30, 'CABINET MEDICAL EXEMPLE'],
  [C.fuel, 5, 40, 80, 'STATION EXEMPLE'],
  [C.tolls, 8, 2, 15, 'AUTOROUTE EXEMPLE'],
  [C.tolls, 5, 2, 8, 'PARKING EXEMPLE'],
  [C.restaurants, 5, 15, 70, 'RESTAURANT EXEMPLE A'],
  [C.restaurants, 5, 10, 40, 'RESTAURANT EXEMPLE B'],
  [C.leisure, 6, 8, 40, 'CINEMA EXEMPLE'],
  [C.clothes, 3, 20, 90, 'BOUTIQUE EXEMPLE'],
  [C.homeEquipment, 2, 20, 150, 'MAGASIN MAISON EXEMPLE'],
  [C.gifts, 1, 20, 80, 'LIBRAIRIE EXEMPLE'],
]

const euros = (n: number) => Math.round(n * 100)
const day = (month: Month, d: number): IsoDate => {
  const last = Number(lastDayOfMonth(month).slice(8, 10))
  return `${month}-${String(Math.min(d, last)).padStart(2, '0')}`
}
function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function threeYearsSeedInput(options: GeneratorOptions = {}): SeedInput {
  const endMonth = options.endMonth ?? '2027-03'
  const count = options.months ?? 36
  const rnd = random(options.seed ?? 20270315)
  const start = addMonths(endMonth, -(count - 1))
  const at = (offset: number) => addMonths(start, offset)
  const openingDate = lastDayOfMonth(addMonths(start, -1))

  const categories: Category[] = CATEGORIES.map(([id, name, sectionId, parentId]) => ({
    id,
    name,
    parentId,
    sectionId,
    sortOrder: id,
    archivedAt: null,
  }))

  // Budget lines and their versions. Yearly raises, one change planned then replaced (R3),
  // one line archived after two years (R4), replaced by another one.
  const budgetLines: BudgetLine[] = []
  const versions: BudgetLineVersion[] = []
  let versionId = 200
  const line = (id: Id, label: string, steps: [Id, number, Month, Month | null, Rhythm, string?][]) => {
    budgetLines.push({ id, label })
    for (const [categoryId, amount, startMonth, endMonthOfVersion, rhythm, replacedAt] of steps) {
      versions.push({
        id: ++versionId,
        budgetLineId: id,
        categoryId,
        amountCents: euros(amount),
        startMonth,
        endMonth: endMonthOfVersion,
        replacedAt: replacedAt ?? null,
        rhythm,
      })
    }
  }
  const yearly = (categoryId: Id, amounts: number[]) =>
    amounts.map((amount, y): [Id, number, Month, Month | null, Rhythm] => [
      categoryId,
      amount,
      at(12 * y),
      y === amounts.length - 1 ? null : at(12 * y + 11),
      monthly(start),
    ])
  const years = Math.ceil(count / 12)
  const raise = (base: number, step: number) => Array.from({ length: years }, (_, y) => base + step * y)

  line(101, 'Salaire personne 1', yearly(C.salary1, raise(2800, 60)))
  line(102, 'Salaire personne 2', yearly(C.salary2, raise(2200, 50)))
  line(103, 'Prêt immobilier', [[C.housing, 1200, start, null, monthly(start)]])
  line(104, 'Courses', yearly(C.groceries, raise(800, 50)))
  line(105, 'Chats', [[C.cats, 40, start, null, monthly(start)]])
  line(106, 'Énergie', [
    [C.energy, 150, start, at(23), monthly(start)],
    [C.energy, 165, at(24), null, monthly(start), `${at(10)}-12T19:00:00.000Z`],
    [C.energy, 170, at(24), null, monthly(start)],
  ])
  line(107, 'Crèche', [[C.childcare, 400, start, at(23), ticked(SCHOOL_MONTHS)]])
  line(108, 'Assurance auto', [[C.insuranceCar, 240, start, null, { kind: 'every_n', everyN: 3, anchorMonth: start }]])
  line(109, 'Assurance habitation', [[C.insuranceHome, 360, start, null, { kind: 'every_n', everyN: 12, anchorMonth: start }]])
  line(110, 'Virement livret A', [[C.savingsAccount, 300, start, null, monthly(start)]])
  line(111, 'Téléphone et internet', [[C.phone, 60, start, null, monthly(start)]])
  line(112, 'Impôts', [[C.taxes, 250, start, null, ticked([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]])
  line(113, 'Carburant', [[C.transport, 180, start, null, monthly(start)]])
  line(114, 'Restaurants', [[C.restaurants, 120, start, null, monthly(start)]])
  line(115, 'Loisirs', [[C.leisure, 100, start, null, monthly(start)]])
  line(116, 'Vêtements', [[C.clothes, 80, start, null, monthly(start)]])
  line(117, 'Activités des enfants', [[C.activities, 90, start, null, ticked(SCHOOL_MONTHS)]])
  line(118, 'Vacances', [[C.holidays, 1500, start, null, ticked([7, 8])]])
  line(119, 'Cadeaux de Noël', [[C.gifts, 400, start, null, ticked([12])]])
  if (count > 24) line(120, 'Périscolaire', [[C.childcare, 150, at(24), null, ticked(SCHOOL_MONTHS)]])

  // Overrides: Courses in December, one override removed then set again.
  const overrides: BudgetOverride[] = []
  let overrideId = 300
  for (let k = 0; k < count; k++) {
    if (monthOfYear(at(k)) === 12) {
      overrides.push({ id: ++overrideId, budgetLineId: 104, month: at(k), amountCents: euros(1100), reason: 'Fêtes', removedAt: null })
    }
  }
  overrides.push({ id: ++overrideId, budgetLineId: 114, month: at(5), amountCents: euros(200), reason: null, removedAt: `${at(4)}-20T19:00:00.000Z` })
  overrides.push({ id: ++overrideId, budgetLineId: 114, month: at(5), amountCents: euros(250), reason: 'Anniversaire', removedAt: null })

  const data: BudgetData = {
    sections: SECTIONS,
    categories,
    budgetLines,
    versions,
    overrides,
    operations: [],
    parts: [],
    openingBalance: { balanceDate: openingDate, amountCents: euros(3000) },
  }
  const planning = new Ledger(structuredClone(data))
  const planned = (lineId: Id, month: Month) => planning.lineInMonth(lineId, month)?.amountCents ?? 0
  const applies = (lineId: Id, month: Month) =>
    versions.some((v) => v.budgetLineId === lineId && v.replacedAt === null && versionApplies(v, month))

  // Operations.
  const operations: Operation[] = []
  const parts: OperationPart[] = []
  const lastDay = lastDayOfMonth(endMonth)
  const add = (
    opDate: IsoDate,
    valueDate: IsoDate,
    amountCents: number,
    label: string | null,
    split: [Id | null, number][],
    extra: Partial<Operation> = {},
  ) => {
    if (valueDate > lastDay || valueDate <= openingDate || amountCents === 0) return
    const id = operations.length + 1
    operations.push({
      id,
      opDate,
      valueDate,
      amountCents,
      origin: label === null ? 'manual' : 'import',
      bankLabel: label === null ? null : normalizeBankLabel(label),
      bankLabelRaw: label === null ? null : firstLine(label),
      dupRank: label === null ? null : 1,
      comment: null,
      archivedAt: null,
      ...extra,
    })
    for (const [categoryId, cents] of split) {
      parts.push({ id: parts.length + 1, operationId: id, categoryId, amountCents: cents })
    }
  }
  const one = (categoryId: Id | null, cents: number): [Id | null, number][] => [[categoryId, cents]]

  for (let k = 0; k < count; k++) {
    const m = at(k)
    const mm = m.slice(5, 7)
    const isEnd = m === endMonth
    // In the month in progress, the operations of the last ten days are still to categorize.
    const cat = (categoryId: Id, date: IsoDate) => (isEnd && Number(date.slice(8, 10)) > 20 ? null : categoryId)
    const fixed = (d: number, cents: number, label: string, categoryId: Id) => {
      const date = day(m, d)
      add(date, date, cents, label, one(cat(categoryId, date), cents))
    }

    fixed(1, planned(101, m), 'VIREMENT EN VOTRE FAVEUR - EMPLOYEUR A EXEMPLE SALAIRE\nREF000000000000', C.salary1)
    fixed(1, planned(102, m), 'VIREMENT EN VOTRE FAVEUR - EMPLOYEUR B EXEMPLE SALAIRE\nREF000000000000', C.salary2)
    fixed(5, -planned(103, m), 'PRELEVEMENT - BANQUE EXEMPLE - ECHEANCE PRET', C.housing)
    fixed(8, -planned(111, m), 'PRELEVEMENT - OPERATEUR EXEMPLE - FACTURE', C.phone)
    fixed(15, -planned(106, m) - euros(rnd.int(0, 20)), 'PRELEVEMENT - ENERGIE EXEMPLE - FACTURE MENSUELLE', C.energy)
    if (applies(112, m)) fixed(15, -planned(112, m), 'PRELEVEMENT - IMPOTS EXEMPLE - MENSUALISATION', C.taxes)
    if (applies(107, m)) fixed(15, -planned(107, m), `VIREMENT EMIS - CRECHE EXEMPLE ${mm}`, C.childcare)
    if (applies(120, m)) fixed(15, -planned(120, m), `VIREMENT EMIS - PERISCOLAIRE EXEMPLE ${mm}`, C.childcare)
    if (applies(108, m)) fixed(10, -euros(rnd.int(240, 250)), 'PRELEVEMENT - ASSUREUR EXEMPLE - ASSURANCE AUTO', C.insuranceCar)
    if (applies(109, m)) fixed(22, -euros(372), 'PRELEVEMENT - ASSUREUR EXEMPLE - ASSURANCE HABITATION', C.insuranceHome)
    fixed(25, -planned(110, m), 'VIREMENT EMIS - VERS LIVRET A EXEMPLE', C.savingsAccount)
    fixed(12, -1399, 'PRELEVEMENT - STREAMING EXEMPLE', C.leisure)

    // Card payments: the label carries the purchase date; the bank books it that day or the next.
    const card = (categoryId: Id, cents: number, shop: string, split?: [Id, number][]) => {
      const purchase = day(m, rnd.int(1, 28))
      const opDate = rnd.chance(0.6) ? addDays(purchase, 1) : purchase
      const label = `PAIEMENT PAR CARTE - X0000 ${shop} ${purchase.slice(8, 10)}/${purchase.slice(5, 7)} - VILLE EXEMPLE`
      const parts = split ?? one(categoryId, -cents)
      add(opDate, opDate, -cents, label, parts.map(([c, v]) => [cat(c as Id, opDate), v]))
    }
    for (const [categoryId, avg, min, max, shop] of SHOPS) {
      const n = Math.round(avg * rnd.between(0.85, 1.15))
      for (let i = 0; i < n; i++) {
        const cents = euros(rnd.between(min, max))
        if (shop === 'SUPERMARCHE EXEMPLE' && rnd.chance(0.06)) {
          const forCats = Math.round(cents * rnd.between(0.1, 0.3))
          card(categoryId, cents, shop, [
            [C.supermarket, -(cents - forCats)],
            [C.cats, -forCats],
          ])
        } else {
          card(categoryId, cents, shop)
        }
      }
    }
    // Two identical payments (same day, amount and label): told apart by their rank (spec 4.4).
    {
      const date = day(m, 14)
      const label = `PAIEMENT PAR CARTE - X0000 PARKING EXEMPLE ${date.slice(8, 10)}/${mm} - VILLE EXEMPLE`
      add(date, date, -250, label, one(cat(C.tolls, date), -250))
      add(date, date, -250, label, one(cat(C.tolls, date), -250))
    }
    if (SCHOOL_MONTHS.includes(monthOfYear(m))) {
      for (let i = 0; i < 2; i++) card(C.activities, euros(rnd.between(15, 60)), 'CLUB EXEMPLE')
    }
    if (monthOfYear(m) === 12) for (let i = 0; i < 6; i++) card(C.gifts, euros(rnd.between(20, 80)), 'MAGASIN DE JOUETS EXEMPLE')
    if ([7, 8].includes(monthOfYear(m))) for (let i = 0; i < 15; i++) card(C.holidays, euros(rnd.between(30, 200)), 'HOTEL EXEMPLE')

    // Refunds (R7): positive operations in an expense category; a one-off income now and then.
    for (let i = 0; i < 4; i++) {
      const date = day(m, rnd.int(3, 28))
      const cents = euros(rnd.between(5, 25))
      add(date, date, cents, 'VIREMENT EN VOTRE FAVEUR - CPAM EXEMPLE REMBOURSEMENT\nREF000000000000', one(cat(rnd.chance(0.5) ? C.pharmacy : C.doctor, date), cents))
    }
    if (k % 4 === 2) {
      const date = day(m, 18)
      add(date, date, euros(50), 'VIREMENT EN VOTRE FAVEUR - MUTUELLE EXEMPLE', one(cat(C.refunds, date), euros(50)))
    }
    // One manual operation deleted (archived) long ago: out of every calculation.
    if (k === 3) {
      const date = day(m, 9)
      add(date, date, -euros(12), null, one(C.supermarket, -euros(12)), { comment: 'Marché', archivedAt: `${date}T19:00:00.000Z` })
    }
    // Manual operations of the month in progress, not imported yet.
    if (isEnd) {
      for (const d of [12, 16, 19]) {
        const date = day(m, d)
        const cents = -euros(rnd.int(5, 30))
        add(date, date, cents, null, one(C.supermarket, cents), { comment: 'Marché' })
      }
    }
  }

  // Rank among identical imported operations (spec 4.4).
  const seen = new Map<string, number>()
  for (const o of operations) {
    if (o.origin !== 'import') continue
    const key = `${o.opDate}|${o.valueDate}|${o.amountCents}|${o.bankLabel}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    o.dupRank = n
  }

  data.operations = operations
  data.parts = parts

  // A balance check at the end of each month: no gap, except a forgotten operation once.
  const ledger = new Ledger(structuredClone(data))
  const balanceChecks: SeedBalanceCheck[] = []
  for (let k = 0; k < count; k++) {
    const date = k === count - 1 ? day(at(k), 20) : lastDayOfMonth(at(k))
    const app = ledger.balanceAt(date)
    const gap = k === 6 ? -euros(35) : 0
    balanceChecks.push({ id: k + 1, checkDate: date, bankBalanceCents: app - gap, gapCents: gap })
  }

  const opById = new Map(operations.map((o) => [o.id, o]))
  const partById = new Map(parts.map((p) => [p.id, p]))
  const setup = `${openingDate}T19:00:00.000Z`
  const authorship = (table: string, id: Id): Authorship => {
    const who = ((id * 2654435761) >>> 0) % 2 === 0 ? 0 : 1
    if (table === 'operation' || table === 'operation_part') {
      const op = opById.get(table === 'operation' ? id : (partById.get(id)?.operationId ?? 0))
      const created = `${op ? addDays(op.valueDate, 1) : openingDate}T19:00:00.000Z`
      const manual = op?.origin === 'manual'
      return { createdBy: manual ? (who as 0 | 1) : 0, createdAt: created, updatedBy: who as 0 | 1, updatedAt: created }
    }
    if (table === 'balance_check') {
      const date = balanceChecks[id - 1]?.checkDate ?? openingDate
      return { createdBy: 0, createdAt: `${date}T20:00:00.000Z`, updatedBy: 0, updatedAt: `${date}T20:00:00.000Z` }
    }
    return { createdBy: 0, createdAt: setup, updatedBy: who as 0 | 1, updatedAt: setup }
  }

  return { data, balanceChecks, authorship }
}
