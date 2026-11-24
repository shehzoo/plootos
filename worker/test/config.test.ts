// Settings that protect production: checked on the configuration files themselves.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { here } from './d1'

const read = (path: string) => readFileSync(here(`../../${path}`), 'utf8')
/** wrangler.jsonc without its comments. */
const wrangler = JSON.parse(
  read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''),
) as {
  vars: Record<string, string>
  observability: { enabled: boolean }
  env: Record<string, { vars: Record<string, string>; observability: { enabled: boolean }; preview_urls: boolean }>
}

describe('wrangler.jsonc', () => {
  it('marks each environment, so that a simulated date is never honoured in production', () => {
    expect(wrangler.vars.ENVIRONMENT).toBe('local')
    expect(wrangler.env.staging?.vars.ENVIRONMENT).toBe('staging')
    expect(wrangler.env.production?.vars.ENVIRONMENT).toBe('production')
  })

  it('keeps Workers Logs off and preview addresses off everywhere', () => {
    expect(wrangler.observability.enabled).toBe(false)
    for (const name of ['staging', 'production']) {
      expect(wrangler.env[name]?.observability.enabled).toBe(false)
      expect(wrangler.env[name]?.preview_urls).toBe(false)
    }
  })
})

describe('GitHub actions', () => {
  it('"Données de recette" only ever reaches staging', () => {
    const yml = read('.github/workflows/donnees-de-recette.yml')
    expect(yml).toMatch(/environment: staging/)
    expect(yml).not.toMatch(/--env production|environment: production/)
    expect(yml.match(/--env staging --remote/g)?.length).toBe(3)
  })
})
