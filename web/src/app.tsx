import { useCallback, useEffect, useState } from 'preact/hooks'
import type { MeResponse } from '../../shared/src/api'
import { apiGet, ForbiddenError, OfflineError, SessionExpiredError } from './api'
import { navigate, SECTIONS, useSection, type Section } from './router'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; me: MeResponse }
  | { state: 'offline' }
  | { state: 'forbidden' }
  | { state: 'expired' }
  | { state: 'error' }

const PLACEHOLDER: Record<Section, string> = {
  mois: 'Le mois en cours arrive au lot 5.',
  operations: 'Les opérations arrivent au lot 6.',
  projection: 'La projection arrive au lot 6.',
  budget: 'Les lignes de budget arrivent au lot 6.',
}

function Nav({ current, variant }: { current: Section; variant: 'sidebar' | 'bottombar' }) {
  return (
    <nav class={variant} aria-label="Navigation principale">
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={s.path}
          aria-current={s.id === current ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault()
            navigate(s.path)
          }}
        >
          {s.label}
        </a>
      ))}
    </nav>
  )
}

function Message({ title, text, retry }: { title: string; text: string; retry?: () => void }) {
  return (
    <main class="message">
      <div role="alert">
        <h1>{title}</h1>
        <p>{text}</p>
        {retry && (
          <button type="button" onClick={retry}>
            Réessayer
          </button>
        )}
      </div>
    </main>
  )
}

export function App() {
  const section = useSection()
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const fetchMe = useCallback(async () => {
    setLoad({ state: 'loading' })
    try {
      setLoad({ state: 'ready', me: await apiGet<MeResponse>('/api/me') })
    } catch (e) {
      if (e instanceof OfflineError) setLoad({ state: 'offline' })
      else if (e instanceof ForbiddenError) setLoad({ state: 'forbidden' })
      else if (e instanceof SessionExpiredError) setLoad({ state: 'expired' })
      else setLoad({ state: 'error' })
    }
  }, [])

  useEffect(() => {
    void fetchMe()
  }, [fetchMe])

  if (load.state === 'loading') return <main class="message" aria-busy="true" />
  if (load.state === 'offline')
    return <Message title="Pas de réseau" text="L'appli a besoin d'internet. Réessaie quand le réseau revient." retry={fetchMe} />
  if (load.state === 'forbidden')
    return <Message title="Accès refusé" text="Cette adresse e-mail n'est pas autorisée." />
  if (load.state === 'expired')
    return <Message title="Connexion expirée" text="Recharge la page pour te reconnecter." retry={() => window.location.reload()} />
  if (load.state === 'error')
    return <Message title="Erreur" text="Quelque chose n'a pas marché." retry={fetchMe} />

  const current = SECTIONS.find((s) => s.id === section)!
  return (
    <div class="shell">
      <Nav current={section} variant="sidebar" />
      <div class="content">
        <header class="topbar">
          <h1>{current.label}</h1>
          <span class="who">Bonjour {load.me.firstName}</span>
        </header>
        <main>
          <p class="placeholder">{PLACEHOLDER[section]}</p>
        </main>
      </div>
      <Nav current={section} variant="bottombar" />
    </div>
  )
}
