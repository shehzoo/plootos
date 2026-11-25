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

export interface Place {
  section: Section
  /** /mois/AAAA-MM: a month other than the current one (null: the current month). */
  month: Month | null
  /** ?categorie=ID: the detail of a category, open. */
  categoryId: number | null
}

export function placeFromLocation(pathname: string, search: string): Place {
  const section = sectionFromPath(pathname)
  const parts = pathname.split('/').filter(Boolean)
  const month = parts[0] === 'mois' && parts[1] && isMonth(parts[1]) ? parts[1] : null
  const raw = new URLSearchParams(search).get('categorie')
  const categoryId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
  return { section, month, categoryId }
}

/** Path of a month screen: the current month is "/", another one "/mois/AAAA-MM". */
export function monthPath(month: Month | null, categoryId: number | null = null): string {
  const base = month === null ? '/' : `/mois/${month}`
  return categoryId === null ? base : `${base}?categorie=${categoryId}`
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
