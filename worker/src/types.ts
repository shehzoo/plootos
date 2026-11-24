export interface Bindings {
  ASSETS: Fetcher
  DB: D1Database
  /** 'local', 'staging' or 'production' (wrangler.jsonc vars). Anything else counts as production. */
  ENVIRONMENT?: string
  /** e.g. https://<team>.cloudflareaccess.com (secret, set by CI). */
  ACCESS_TEAM_DOMAIN?: string
  /** Audience tag of the Access application (secret, set by CI). */
  ACCESS_AUD?: string
  /** JSON {"address": "First name"} of the two allowed people (secret, set by CI). */
  ALLOWED_USERS?: string
  /** Local development only, in .dev.vars: address used without Access. */
  DEV_AUTH_EMAIL?: string
}

export interface User {
  email: string
  firstName: string
}

export interface AppEnv {
  Bindings: Bindings
  Variables: { user: User; users: Map<string, string> }
}
