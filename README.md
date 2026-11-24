# Plootos

Plootos : appli web installable de budget familial, pour deux personnes, sur ordinateur et téléphone.
Hébergée chez Cloudflare (Workers, D1 en juridiction UE, Access).

Ce dépôt ne contient que du code et des données fictives. Aucune donnée réelle, aucune
adresse e-mail, aucun identifiant n'y entre : les réglages d'accès vivent dans les secrets
des environnements GitHub, les données dans la base.

## Structure

| Dossier | Contenu |
|---------|---------|
| `shared/` | Code partagé entre le navigateur et le Worker : moteur de calcul (`shared/src/engine`), testé sur les cas de la spec |
| `worker/` | Code serveur (Hono) : vérifie le jeton d'Access, contrôle les écritures |
| `web/` | Appli dans le navigateur (Preact, Vite) |
| `migrations/` | Changements de schéma de la base, versionnés |
| `.github/workflows/` | Tests, recette, mise en production |

## Développement local

```sh
npm ci
cp .dev.vars.example .dev.vars   # valeurs fictives
npm run dev                      # http://localhost:8787
npm run check                    # types, tests, build
```

En local seulement, `DEV_AUTH_EMAIL` remplace Access ; le Worker l'ignore hors de
`localhost`.

## Environnements

| Environnement | Où | Données | Déployé |
|---------------|----|---------|---------|
| Local | `wrangler dev` | Base locale fictive | À la main |
| Recette (`staging`) | Compte Cloudflare « Plootos Staging », `app.plootos-staging.workers.dev` derrière Access | Fictives | À chaque demande de fusion, et après chaque « Merge » sur `main` |
| Production (`production`) | Compte Cloudflare « Plootos Prod », `app.plootos.workers.dev` derrière Access | Réelles | Après « Merge » sur `main`, quand la variable `PRODUCTION_ENABLED` vaut `true` ; « Run workflow » la lance à la main |

Secrets de chaque environnement GitHub (`staging`, `production`) :
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`,
`ALLOWED_USERS` (`{"adresse": "Prénom"}`).

Variable du dépôt : `PRODUCTION_ENABLED` (`true` une fois le compte « Plootos Prod » et ses
secrets en place ; absente, un « Merge » ne déploie rien en production).
