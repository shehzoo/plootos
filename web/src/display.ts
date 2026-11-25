// Display preferences, kept on each device (spec 4.5: never data): the width of the screen,
// and the sections folded on the month screens (spec 3.1: remembered on each device).

import { useCallback, useEffect, useState } from 'preact/hooks'

/** Phone layout below the design system's size-phone-max (760px), whatever the device (spec 4.2). */
export const PHONE_QUERY = '(max-width: 760px)'

export function useNarrow(): boolean {
  const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null)
  const [narrow, setNarrow] = useState(() => query()?.matches ?? false)
  useEffect(() => {
    const mql = query()
    if (!mql) return
    const onChange = () => setNarrow(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return narrow
}

const FOLDED_KEY = 'plootos.foldedSections'

function readFolded(): Set<number> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FOLDED_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((x): x is number => typeof x === 'number') : [])
  } catch {
    return new Set()
  }
}

/** Sections folded by the person on this device; everything is unfolded by default. */
export function useFoldedSections(): [Set<number>, (id: number) => void] {
  const [folded, setFolded] = useState(readFolded)
  const toggle = useCallback((id: number) => {
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        window.localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]))
      } catch {
        // Storage unavailable (private browsing): folding still works until the page reloads.
      }
      return next
    })
  }, [])
  return [folded, toggle]
}
