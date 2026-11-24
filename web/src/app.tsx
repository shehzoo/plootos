import { useCallback, useEffect, useState } from 'preact/hooks'
import type { MeResponse } from '../../shared/src/api'
import { apiGet, AppOutdatedError, ForbiddenError, OfflineError, SessionExpiredError } from './api'
import { loadData, type Loaded } from './data'
import { navigate, SECTIONS, useSection, type Section } from './router'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; me: MeResponse; data: Loaded }
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

const ms = (v: number) => `${Math.round(v)} ms`
const frenchDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * Local development and staging only: what was loaded and how long it took (lot 3 criterion,
 * under 2 s on a phone with three years of data), and the server's "today".
 */
function Diagnostics({ data }: { data: Loaded }) {
  if (data.environment === 'production') return null
  const t = data.timings
  return (
    <p class="diagnostics">
      {data.app.operations.length} opérations, {(data.bytes / 1e6).toFixed(1)} Mo · chargé en {ms(t.totalMs)} (réseau{' '}
      {ms(t.networkMs)}, lecture {ms(t.readMs)}, calcul {ms(t.computeMs)}) · aujourd'hui : {frenchDate(data.today)}
      {data.todaySimulated ? ' (date simulée)' : ''} · {data.environment === 'staging' ? 'recette' : 'local'}
    </p>
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
      const [me, data] = await Promise.all([apiGet<MeResponse>('/api/me'), loadData()])
      setLoad({ state: 'ready', me, data })
    } catch (e) {
      if (e instanceof OfflineError) setLoad({ state: 'offline' })
      else if (e instanceof ForbiddenError) setLoad({ state: 'forbidden' })
      else if (e instanceof SessionExpiredError) setLoad({ state: 'expired' })
      else if (e instanceof AppOutdatedError) setLoad({ state: 'loading' })
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
          <p class="placeholder">
            {load.data.ledger ? PLACEHOLDER[section] : 'Base vide : la mise en service arrive au lot 7.'}
          </p>
          <Diagnostics data={load.data} />
        </main>
      </div>
      <Nav current={section} variant="bottombar" />
    </div>
  )
}
