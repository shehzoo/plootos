// Budget: the lines (3.6), and on a computer the tabs « Catégories » (3.7) and « Données » (3.8).
// A phone only has the lines (spec 3.0).

import type { MonthContext } from '../month/view'
import { budgetTabPath, navigate, type BudgetTab, type Place } from '../router'
import { BudgetScreen } from './BudgetScreen'
import { CategoriesScreen } from './CategoriesScreen'
import { DataScreen } from './DataScreen'

const TABS: { id: BudgetTab; label: string }[] = [
  { id: 'lignes', label: 'Lignes de budget' },
  { id: 'categories', label: 'Catégories' },
  { id: 'donnees', label: 'Données' },
]

export function BudgetArea({ ctx, place, narrow, refresh }: { ctx: MonthContext; place: Place; narrow: boolean; refresh: () => Promise<void> }) {
  if (narrow) return <BudgetScreen ctx={ctx} place={place} narrow />
  return (
    <>
      <nav class="pl-seg budget-tabs" aria-label="Budget">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={place.tab === t.id} onClick={() => navigate(budgetTabPath(t.id))}>
            {t.label}
          </button>
        ))}
      </nav>
      {place.tab === 'categories' ? (
        <CategoriesScreen ctx={ctx} refresh={refresh} />
      ) : place.tab === 'donnees' ? (
        <DataScreen ctx={ctx} refresh={refresh} />
      ) : (
        <BudgetScreen ctx={ctx} place={place} narrow={false} />
      )}
    </>
  )
}
