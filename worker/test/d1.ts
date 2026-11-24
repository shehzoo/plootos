// Local D1 database for the tests (workerd, through wrangler), with the real migrations.

import { readdirSync, readFileSync } from 'node:fs'
import { getPlatformProxy } from 'wrangler'
import { dropSql } from '../../shared/fixtures/seed'

/** Plain paths (Linux, macOS): the Worker and Node types disagree on URL. */
export const here = (relative: string) => decodeURIComponent(new URL(relative, import.meta.url).pathname)

const MIGRATIONS = here('../../migrations/')

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** Statements of a SQL file: comment lines dropped, split at each ';' ending a line. */
export function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function runSql(db: D1Database, sql: string): Promise<void> {
  const list = statements(sql)
  if (list.length > 0) await db.batch(list.map((s) => db.prepare(s)))
}

export interface TestDb {
  db: D1Database
  /** Empty database at the latest schema. */
  reset(): Promise<void>
  dispose(): Promise<void>
}

export async function testDb(): Promise<TestDb> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: here('./wrangler.test.jsonc'),
    persist: false,
  })
  const db = proxy.env.DB
  const reset = async () => {
    await runSql(db, dropSql())
    for (const f of migrationFiles()) await runSql(db, readFileSync(MIGRATIONS + f, 'utf8'))
  }
  await reset()
  return { db, reset, dispose: () => proxy.dispose() }
}
