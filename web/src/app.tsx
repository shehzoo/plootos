import { useCallback, useEffect, useState } from 'preact/hooks'
import type { MeResponse } from '../../shared/src/api'
import { isIsoDate } from '../../shared/src/engine'
import { apiGet, AppOutdatedError, ForbiddenError, OfflineError, SessionExpiredError, SIMULATED_TODAY_KEY } from './api'
import { loadData, type Loaded } from './data'
import logoDark from './design/logo/plootos-mot-clair.svg'
import logoLight from './design/logo/plootos-mot-sauge.svg'
import { useNarrow } from './display'
import { MonthScreen } from './month/MonthScreen'
import { navigate, SECTIONS, usePlace, type Section } from './router'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; me: MeResponse; data: Loaded }
  | { state: 'offline' }
  | { state: 'forbidden' }
  | { state: 'expired' }
  | { state: 'error' }

const PLACEHOLDER: Record<Exclude<Section, 'mois'>, string> = {
  operations: 'Les opérations arrivent au lot 6.',
  projection: 'La projection arrive au lot 6.',
  budget: 'Les lignes de budget arrivent au lot 6.',
}

/** SideNav on a computer, BottomNav on a phone (design system). */
function Nav({ current, variant, firstName }: { current: Section; variant: 'side' | 'bottom'; firstName: string }) {
  const links = SECTIONS.map((s) => (
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
  ))
  if (variant === 'bottom') {
    return (
      <nav class="pl-bottomnav label shell__bottom" aria-label="Navigation principale">
        {links}
      </nav>
    )
  }
  return (
    <nav class="pl-sidenav shell__side" aria-label="Navigation principale">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset={logoDark} />
        <img class="pl-sidenav__logo" src={logoLight} alt="plootos" width={79} height={24} />
      </picture>
      {links}
      <span class="pl-sidenav__who caption">{firstName}</span>
    </nav>
  )
}

const ms = (v: number) => `${Math.round(v)} ms`
const frenchDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Test setting kept on the device: the server honours it in local development and staging only. */
function setSimulatedToday(value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(SIMULATED_TODAY_KEY)
    else window.localStorage.setItem(SIMULATED_TODAY_KEY, value)
  } catch {
    return
  }
  window.location.reload()
}

/** Local development and staging only: the field to simulate "today" (lot 5). */
function SimulatedToday({ data }: { data: Loaded }) {
  const [value, setValue] = useState(data.today)
  return (
    <form
      class="diagnostics__today"
      onSubmit={(e) => {
        e.preventDefault()
        if (isIsoDate(value)) setSimulatedToday(value)
      }}
    >
      <label class="label" for="simulated-today">
        Date simulée
      </label>
      <span class="pl-input diagnostics__date">
        <input id="simulated-today" type="date" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
      </span>
      <button type="submit" class="pl-btn label" disabled={!isIsoDate(value)}>
        Appliquer
      </button>
      {data.todaySimulated && (
        <button type="button" class="pl-btn pl-btn--ghost label" onClick={() => setSimulatedToday(null)}>
          Revenir à aujourd'hui
        </button>
      )}
    </form>
  )
}

/**
 * Local development and staging only: what was loaded and how long it took (lot 3 criterion,
 * under 2 s on a phone with three years of data), the server's "today" and its simulation.
 */
function Diagnostics({ data }: { data: Loaded }) {
  if (data.environment === 'production') return null
  const t = data.timings
  return (
    <footer class="diagnostics">
      <SimulatedToday data={data} />
      <p class="caption">
        {data.app.operations.length} opérations, {(data.bytes / 1e6).toFixed(1)} Mo en {data.requests} requêtes · chargé en {ms(t.totalMs)} (réseau{' '}
        {ms(t.networkMs)}, lecture {ms(t.readMs)}, calcul {ms(t.computeMs)}) · aujourd'hui : {frenchDate(data.today)}
        {data.todaySimulated ? ' (date simulée)' : ''} · {data.environment === 'staging' ? 'recette' : 'local'}
      </p>
    </footer>
  )
}

function Message({ title, text, retry }: { title: string; text: string; retry?: () => void }) {
  return (
    <main class="message">
      <div role="alert">
        <h1 class="title-m">{title}</h1>
        <p>{text}</p>
        {retry && (
          <button type="button" class="pl-btn pl-btn--primary label" onClick={retry}>
            Réessayer
          </button>
        )}
      </div>
    </main>
  )
}

export function App() {
  const place = usePlace()
  const narrow = useNarrow()
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

  const { data, me } = load
  const section = place.section
  const current = SECTIONS.find((s) => s.id === section)!
  const isMonth = section === 'mois' && data.ledger !== null
  return (
    <div class="shell">
      <Nav current={section} variant="side" firstName={me.firstName} />
      <div class={`content${isMonth ? ' content--month' : ''}`}>
        {isMonth && data.ledger ? (
          <main>
            <MonthScreen ctx={{ ledger: data.ledger, app: data.app, today: data.today }} place={place} narrow={narrow} />
          </main>
        ) : (
          <>
            <header class="topbar">
              <h1 class="title-l">{current.label}</h1>
            </header>
            <main>
              <p class="placeholder">
                {data.ledger
                  ? PLACEHOLDER[section as Exclude<Section, 'mois'>]
                  : 'Base vide : la mise en service arrive au lot 7.'}
              </p>
            </main>
          </>
        )}
        <Diagnostics data={data} />
      </div>
      <Nav current={section} variant="bottom" firstName={me.firstName} />
    </div>
  )
}
