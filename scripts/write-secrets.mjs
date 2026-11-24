// Writes the Worker secrets from the GitHub environment to a private file for
// `wrangler deploy --secrets-file`. Values are never printed: Actions logs of a
// public repository are public.
import { writeFileSync } from 'node:fs'

const NAMES = ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ALLOWED_USERS']
const out = process.argv[2]
if (!out) {
  console.error('Usage: node scripts/write-secrets.mjs <output.json>')
  process.exit(1)
}

const missing = NAMES.filter((n) => !process.env[n])
if (missing.length) {
  console.error(`Missing secrets: ${missing.join(', ')}`)
  process.exit(1)
}

try {
  const users = JSON.parse(process.env.ALLOWED_USERS)
  if (!users || typeof users !== 'object' || Array.isArray(users) || Object.keys(users).length === 0) {
    throw new Error()
  }
} catch {
  console.error('ALLOWED_USERS must be a JSON object {"address": "First name"}')
  process.exit(1)
}

if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(process.env.ACCESS_TEAM_DOMAIN)) {
  console.error('ACCESS_TEAM_DOMAIN must look like https://<team>.cloudflareaccess.com')
  process.exit(1)
}

const secrets = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]))
writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 })
console.log(`Secrets written: ${NAMES.join(', ')}`)
