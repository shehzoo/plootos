// Fictitious data sets for a local or staging database (never production).
//
//   npx tsx scripts/seed.ts mask                 GitHub Actions: masks the allowed addresses
//   npx tsx scripts/seed.ts drop                 SQL dropping every table, migration history included
//   npx tsx scripts/seed.ts data <set> [month]   SQL of a data set: exemple, exemple-15-03, cas-a-b, 3-ans [last month], vide
//   npx tsx scripts/seed.ts local <set> [month]  local database of `npm run dev`: drop, migrate, load
//
// Authors are the addresses of ALLOWED_USERS (person 1 is the first one): the staging secret in
// CI, .dev.vars locally. The SQL is written to standard output and holds them: never print it.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { casesABSeedInput, exampleSeedInput } from '../shared/fixtures/example'
import { dropSql, seedSql, toSeed, type Authors } from '../shared/fixtures/seed'
import { threeYearsSeedInput } from '../shared/fixtures/three-years'
import { isMonth } from '../shared/src/engine/dates'

const SETS = ['exemple', 'exemple-15-03', 'cas-a-b', '3-ans', 'vide'] as const

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function addresses(raw: string | undefined): string[] {
  try {
    const users = JSON.parse(raw ?? '') as unknown
    if (users && typeof users === 'object' && !Array.isArray(users)) {
      const list = Object.keys(users).map((a) => a.trim().toLowerCase())
      if (list.length > 0) return list
    }
  } catch {
    // Reported below, without the value.
  }
  return fail('ALLOWED_USERS must be a JSON object {"address": "First name"}')
}

function authors(raw: string | undefined): Authors {
  const [first, second] = addresses(raw)
  return [first as string, second ?? (first as string)]
}

function dataSql(set: string, month: string | undefined, raw: string | undefined): string {
  if (month !== undefined && !isMonth(month)) fail('Month: YYYY-MM')
  if (set === 'vide') return '-- Empty data set: the migrations alone.\nSELECT 1;\n'
  if (set === 'exemple') return seedSql(toSeed(exampleSeedInput(), authors(raw)))
  // The example month as entered on the evening of 15/03 (spec 1.3, U5).
  if (set === 'exemple-15-03') return seedSql(toSeed(exampleSeedInput({ enteredUpTo: '2027-03-15' }), authors(raw)))
  // Cases A and B of spec 1.4, played through the app (lot 8).
  if (set === 'cas-a-b') return seedSql(toSeed(casesABSeedInput(), authors(raw)))
  if (set === '3-ans') return seedSql(toSeed(threeYearsSeedInput({ endMonth: month }), authors(raw)))
  return fail(`Data set: ${SETS.join(', ')}`)
}

function devVars(): string | undefined {
  try {
    const text = readFileSync('.dev.vars', 'utf8')
    const line = text.split('\n').find((l) => l.startsWith('ALLOWED_USERS='))
    return line?.slice('ALLOWED_USERS='.length).trim()
  } catch {
    return fail('.dev.vars missing: cp .dev.vars.example .dev.vars')
  }
}

const [command, set, month] = process.argv.slice(2)

if (command === 'mask') {
  // Every address is masked in the public logs of the run, before anything can print it.
  for (const a of addresses(process.env.ALLOWED_USERS)) console.log(`::add-mask::${a}`)
} else if (command === 'drop') {
  process.stdout.write(dropSql())
} else if (command === 'data') {
  process.stdout.write(dataSql(set ?? '', month, process.env.ALLOWED_USERS))
} else if (command === 'local') {
  const sql = dataSql(set ?? '', month, devVars())
  const dir = mkdtempSync(join(tmpdir(), 'plootos-'))
  const wrangler = (...args: string[]) => execFileSync('npx', ['wrangler', ...args], { stdio: 'inherit' })
  try {
    writeFileSync(join(dir, 'drop.sql'), dropSql())
    writeFileSync(join(dir, 'data.sql'), sql)
    wrangler('d1', 'execute', 'DB', '--local', '--yes', '--file', join(dir, 'drop.sql'))
    wrangler('d1', 'migrations', 'apply', 'DB', '--local')
    wrangler('d1', 'execute', 'DB', '--local', '--yes', '--file', join(dir, 'data.sql'))
    console.log(`Local database: data set "${set}" loaded.`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
} else {
  fail('Usage: seed.ts mask | drop | data <set> [month] | local <set> [month]')
}
