// Tests that run the app's own code against the Worker and a local database: type-checked with
// both the browser's and the Worker's types (integration/tsconfig.json).
// Lot 11: export and restore as the app runs them, against the Worker and a local database
// (spec 3.8, 4.6). Criterion: export, empty, restore, find the example month exactly.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SIMULATED_TODAY_HEADER } from '../shared/src/api'
import { readExport } from '../shared/src/backup'
import { CAT, euros, exampleSeedInput } from '../shared/fixtures/example'
import { seedSql, toSeed } from '../shared/fixtures/seed'
import { createApp } from '../worker/src/app'
import type { Bindings } from '../worker/src/types'
import { runSql, testDb, type TestDb } from '../worker/test/d1'
import { RestoreInProgressError, type ApiDeps } from '../web/src/api'
import { exportData, readExportText, restoreFile } from '../web/src/budget/backup'
import { loadData } from '../web/src/data'

const P1 = 'p1@example.test'
const P2 = 'p2@example.test'
const ORIGIN = 'http://localhost:8787'
const app = createApp()
let t: TestDb
beforeAll(async () => {
  t = await testDb()
}, 60_000)
afterAll(async () => t?.dispose())

const env = (): Bindings => ({
  ASSETS: { fetch: async () => new Response('x') } as unknown as Fetcher,
  DB: t.db,
  ENVIRONMENT: 'local',
  ALLOWED_USERS: JSON.stringify({ [P1]: 'Alice', [P2]: 'Bob' }),
  DEV_AUTH_EMAIL: P1,
})

/** The app's calls, answered by the Worker; `cut` makes one request fail as if the network dropped. */
function deps(cut?: (path: string, n: number) => boolean): ApiDeps {
  let n = 0
  return {
    fetch: (async (path: string, init: RequestInit) => {
      if (cut?.(path, n++)) throw new TypeError('network')
      const headers = { ...(init.headers as Record<string, string>), Origin: ORIGIN, [SIMULATED_TODAY_HEADER]: '2027-04-01' }
      return app.request(`${ORIGIN}${path}`, { ...init, headers }, env())
    }) as unknown as typeof fetch,
    reload: vi.fn(),
    storage: null,
    settings: null,
    now: () => 0,
  }
}

async function seedExample() {
  await t.reset()
  await runSql(t.db, seedSql(toSeed(exampleSeedInput(), [P1, P2])))
}

async function exportText(): Promise<{ name: string; text: string }> {
  let saved = { name: '', text: '' }
  await exportData(deps(), (name, text) => (saved = { name, text }))
  return saved
}

describe('export, empty, restore, as the app does it', () => {
  it('finds the example month exactly, and records the date of the export', async () => {
    await seedExample()
    const before = await loadData(deps())
    expect(before.lastExportAt).toBeNull()
    const { name, text } = await exportText()
    expect(name).toBe('plootos-local-export-2027-04-01.json')
    expect(text).not.toContain('@')
    expect((await loadData(deps())).lastExportAt).not.toBeNull()

    await t.reset()
    const read = readExport(text, 'local')
    if (!read.ok) throw new Error(read.error)
    const progress: number[] = []
    expect(await restoreFile(read.file, (sent) => progress.push(sent), deps())).toEqual({ kind: 'done' })
    expect(progress.at(-1)).toBe(progress.length)

    const after = await loadData(deps())
    expect(after.app).toEqual(before.app)
    expect(after.lastExportAt).toBe(read.file.exportedAt)
    const ledger = after.ledger
    expect(ledger?.monthSummary('2027-03').actualEndBalanceCents).toBe(euros(4998))
    expect(ledger?.gap(CAT.insurance, '2027-03')).toBe(euros(12))
  })

  it('refuses at the first lot on a database that is not empty: nothing written, the app still works', async () => {
    await seedExample()
    const { text } = await exportText()
    const read = readExport(text, 'local')
    if (!read.ok) throw new Error(read.error)
    const out = await restoreFile(read.file, () => undefined, deps())
    expect(out).toMatchObject({ kind: 'refused', message: { text: expect.stringContaining("n'est plus vide") } })
    expect((await loadData(deps())).app.operations).toHaveLength(13)
  })

  it('blocks the app when a later lot is lost, until « Vider la base »', async () => {
    await seedExample()
    const { text } = await exportText()
    const read = readExport(text, 'local')
    if (!read.ok) throw new Error(read.error)
    await t.reset()
    // Lots of five rows; the third request is lost on the way.
    let sent = 0
    const cutting = deps((path) => path === '/api/restore' && ++sent === 3)
    expect(await restoreFile(read.file, () => undefined, cutting, 5)).toEqual({ kind: 'blocked' })
    await expect(loadData(deps())).rejects.toBeInstanceOf(RestoreInProgressError)
  })
})

describe('a chosen file refused, in words', () => {
  it('says why', () => {
    expect(readExportText('other_environment', 'production')).toContain('recette')
    expect(readExportText('other_environment', 'staging')).toContain('données réelles')
    expect(readExportText('not_export', 'local')).toContain("n'est pas un export")
  })
})
