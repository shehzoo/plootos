import { useEffect, useState } from 'preact/hooks'
import { isMonth, type Month } from '../../shared/src/engine'

export type Section = 'mois' | 'operations' | 'projection' | 'budget'

export const SECTIONS: { id: Section; label: string; path: string }[] = [
  { id: 'mois', label: 'Mois', path: '/' },
  { id: 'operations', label: 'Opérations', path: '/operations' },
  { id: 'projection', label: 'Projection', path: '/projection' },
  { id: 'budget', label: 'Budget', path: '/budget' },
]

export function sectionFromPath(pathname: string): Section {
  const first = pathname.split('/').filter(Boolean)[0] ?? ''
  const found = SECTIONS.find((s) => s.path === `/${first}`)
  return found ? found.id : 'mois'
}

/** Tabs of Budget on a computer (spec 3.0): the lines, the categories (3.7), the data (3.8). */
export type BudgetTab = 'lignes' | 'categories' | 'donnees'

export interface Place {
  section: Section
  /** /budget, /budget/categories, /budget/donnees (a phone only has the lines). */
  tab: BudgetTab
  /**
   * /mois/AAAA-MM, /operations/AAAA-MM, /budget/AAAA-MM: a month other than the current one
   * (null: the current month). On Budget, a computer shows the year of that month.
   */
  month: Month | null
  /** ?categorie=ID: the detail of a category, open. */
  categoryId: number | null
  /** ?operation=ID: the record of an operation, open (Opérations). */
  operationId: number | null
  /** ?ligne=ID: the record of a budget line, open (Budget). */
  lineId: number | null
  /** ?nouvelle or ?nouvelle=ID: the panel of a new budget line, its category chosen (Budget, computer). */
  newLine: { categoryId: number | null } | null
  /** /operations/categoriser: screen 3.3, all the operations to categorize (computer). */
  categorize: boolean
  /** ?ajout on Mois or Opérations: the manual entry is open (spec 3.2, lot 9). */
  adding: boolean
}

export function placeFromLocation(pathname: string, search: string): Place {
  const section = sectionFromPath(pathname)
  const parts = pathname.split('/').filter(Boolean)
  const withMonth = parts[0] === 'mois' || parts[0] === 'operations' || parts[0] === 'budget'
  const month = withMonth && parts[1] && isMonth(parts[1]) ? parts[1] : null
  const params = new URLSearchParams(search)
  const id = (name: string) => {
    const raw = params.get(name)
    return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
  }
  const tab: BudgetTab = section === 'budget' && (parts[1] === 'categories' || parts[1] === 'donnees') ? parts[1] : 'lignes'
  const newLine = section === 'budget' && tab === 'lignes' && params.has('nouvelle') ? { categoryId: id('nouvelle') } : null
  const categorize = section === 'operations' && parts[1] === 'categoriser'
  const adding = (section === 'mois' || section === 'operations') && !categorize && params.has('ajout')
  return { section, tab, month, categoryId: id('categorie'), operationId: id('operation'), lineId: id('ligne'), newLine, categorize, adding }
}

/** Screen 3.3, Catégoriser (computer). */
export const CATEGORIZE_PATH = '/operations/categoriser'

/** The same screen, its detail closed, with the manual entry open: a phone's back button closes it. */
export const addingPath = (pathname: string) => `${pathname}?ajout`

/** The screen under the manual entry. */
export function withoutAdding(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.delete('ajout')
  const rest = params.toString()
  return rest ? `${pathname}?${rest}` : pathname
}

/** Path of a month screen: the current month is "/", another one "/mois/AAAA-MM". */
export function monthPath(month: Month | null, categoryId: number | null = null): string {
  const base = month === null ? '/' : `/mois/${month}`
  return categoryId === null ? base : `${base}?categorie=${categoryId}`
}

/** Path of a screen with a month in it: the current month is the bare path. */
function monthlyPath(base: string, month: Month | null, param: string, id: number | null): string {
  const path = month === null ? base : `${base}/${month}`
  return id === null ? path : `${path}?${param}=${id}`
}

/** Opérations: the month, and the operation open in its record. */
export function operationsPath(month: Month | null, operationId: number | null = null): string {
  return monthlyPath('/operations', month, 'operation', operationId)
}

/** Budget: the month (a computer shows its year), and the line open in its record. */
export function budgetPath(month: Month | null, lineId: number | null = null): string {
  return monthlyPath('/budget', month, 'ligne', lineId)
}

/** Budget, with the panel of a new line open, its category chosen (« Ajouter une ligne de budget », spec 3.4). */
export function newLinePath(month: Month | null, categoryId: number | null = null): string {
  const path = month === null ? '/budget' : `/budget/${month}`
  return categoryId === null ? `${path}?nouvelle` : `${path}?nouvelle=${categoryId}`
}

/** Path of a tab of Budget. */
export function budgetTabPath(tab: BudgetTab): string {
  return tab === 'lignes' ? '/budget' : `/budget/${tab}`
}

const PUSHED = 'plootos'

/**
 * Goes to a path of the app. `replace` changes the current entry of the history instead of
 * adding one: the detail panel of a computer does not pile up entries; a phone's detail screen
 * does, so that the phone's back button closes it.
 */
export function navigate(path: string, options: { replace?: boolean } = {}) {
  const current = window.location.pathname + window.location.search
  if (current === path) return
  if (options.replace) window.history.replaceState(window.history.state, '', path)
  else window.history.pushState({ [PUSHED]: true }, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Back to the previous screen of the app if there is one, otherwise to this path. */
export function back(fallback: string) {
  const state = window.history.state as Record<string, unknown> | null
  if (state && state[PUSHED]) window.history.back()
  else navigate(fallback, { replace: true })
}

export function usePlace(): Place {
  const read = () => placeFromLocation(window.location.pathname, window.location.search)
  const [place, setPlace] = useState(read)
  useEffect(() => {
    const onPop = () => setPlace(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return place
}

export function useSection(): Section {
  return usePlace().section
}
