// How a screen writes (spec 4.3): one function runs the write, reloads the data, and turns what
// goes wrong into a message. A conflict ("Modifié entre-temps") reloads the data and keeps the
// screen as it is, so that what was typed is still there to send again.

import { useCallback, useState } from 'preact/hooks'
import { ConflictError, OfflineError, RuleError, SessionExpiredError } from '../api'
import { ruleText } from './catalog'

export interface Message {
  kind: 'conflict' | 'error'
  text: string
}

export function messageOf(e: unknown): Message {
  if (e instanceof ConflictError) {
    return {
      kind: 'conflict',
      text: "Modifié entre-temps : les données ont été rechargées. Vérifie, puis recommence si c'est toujours utile.",
    }
  }
  if (e instanceof RuleError) return { kind: 'error', text: ruleText(e.code) }
  if (e instanceof OfflineError) return { kind: 'error', text: "Pas de réseau : rien n'est sûr d'être enregistré. Vérifie, puis réessaie." }
  if (e instanceof SessionExpiredError) return { kind: 'error', text: 'Connexion expirée : la page se recharge.' }
  return { kind: 'error', text: "Quelque chose n'a pas marché." }
}

/** Runs writes one at a time; `refresh` reloads all the data after each one. */
export function useWriter(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  const run = useCallback(
    async (write: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true)
      setMessage(null)
      try {
        await write()
      } catch (e) {
        if (e instanceof ConflictError) await refresh().catch(() => undefined)
        setMessage(messageOf(e))
        setBusy(false)
        return false
      }
      try {
        await refresh()
      } catch {
        setMessage({ kind: 'error', text: "Enregistré, mais l'appli n'a pas pu se recharger : recharge la page." })
      }
      setBusy(false)
      return true
    },
    [refresh],
  )

  return { busy, message, run, clear: () => setMessage(null) }
}

