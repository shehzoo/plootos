import { useEffect, useState } from 'preact/hooks'

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

export function navigate(path: string) {
  if (window.location.pathname === path) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useSection(): Section {
  const [section, setSection] = useState(() => sectionFromPath(window.location.pathname))
  useEffect(() => {
    const onPop = () => setSection(sectionFromPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return section
}
