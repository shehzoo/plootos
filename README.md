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
| `design/source/` | Copie du design system, dont la référence est l'artefact Claude « Plootos » (type Design System) : jetons, charte, composants, icônes |
| `DESIGN.md`, `web/src/design/` | Générés depuis `design/source/` par `npm run design` : design system au format DESIGN.md, variables CSS, styles des composants (`pl-*`) ; police Figtree auto-hébergée et mot-symbole |
| `shared/fixtures/` | Jeux de données fictives (mois d'exemple, 3 ans), pour les tests et les bases locale et de recette ; jamais dans l'appli |
| `migrations/` | Changements de schéma de la base, versionnés (`0001_initial.sql` : toutes les tables de la spec 4.5) |
| `scripts/` | Chargement des données fictives, secrets du déploiement |
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

```sh
npm run seed -- exemple          # base locale : mois d'exemple (spec 1.3), pour la date simulée du 01/04
npm run seed -- exemple-15-03    # le mois d'exemple tel qu'entré le 15/03 au soir
npm run seed -- 3-ans [AAAA-MM]  # 36 mois fictifs finissant à ce mois (mars 2027 par défaut)
npm run seed -- vide             # base vide, comme avant la mise en service
```

Date simulée (local et recette seulement) : champ « Date simulée » en bas de page, puis
« Appliquer » ; « Revenir à aujourd'hui » l'efface. Elle est gardée sur l'appareil.
En local et en recette, une ligne en bas de page donne le volume chargé, les temps de
chargement et la date du jour du serveur.

## Design system

La référence est l'artefact Claude « Plootos » (type Design System). Pour le changer : le
modifier dans l'artefact, recopier ses fichiers dans `design/source/`, puis `npm run design`. Un
test échoue si `DESIGN.md`, `web/src/design/tokens.css` ou `web/src/design/components.css` ne
correspondent plus à leur source. Les écrans n'écrivent aucune couleur, taille ou police en dur :
seulement les variables et les classes du design system.

## Base, lecture, écriture

| Point | Où |
|-------|----|
| Lecture | `GET /api/data` : tout sauf les opérations, et le nombre de pages ; `GET /api/data/operations/:page` : 1 000 opérations et leurs parts. L'appli lit les pages en parallèle et relit tout si une page cite un élément inconnu. SQLite construit le JSON par paquets de 200 rangées (`worker/src/read.ts`) ; les auteurs y sont des prénoms, jamais des adresses |
| Écriture | `WriteBatch` (`worker/src/write.ts`) : un lot D1 tout-ou-rien ; auteur et dates remplis ; `row_version` vérifié par une « garde » dans le lot (conflit : 409 `conflict` avec les éléments modifiés) ; refus pendant une restauration |
| Écritures du catalogue (lot 7) | `worker/src/catalog.ts` : `POST /api/setup` (solde initial, six sections, base vide seulement), sections et catégories (`POST`, `PATCH`, `…/archive`), `POST /api/order` (ordre complet d'un groupe), `PATCH /api/opening-balance`. R4 (aucune ligne active) et R10 (même sens, parente fixe, première sous-catégorie confirmée) sont vérifiées par des gardes du lot D1. Côté appli : `apiSend` (`web/src/api.ts`) et `useWriter` (`web/src/budget/write.ts`) envoient, relisent toutes les données et expliquent un refus ou « Modifié entre-temps » |
| Contrôles de chaque requête | `worker/src/security.ts` : numéro de compatibilité (`X-Plootos-Api`, sinon 409 `app_outdated` et l'appli se recharge), origine et JSON pour une écriture, en-têtes de sécurité et CSP stricte |
| Journaux | Workers Logs coupés ; le Worker n'écrit que des codes fixes |

## Environnements

| Environnement | Où | Données | Déployé |
|---------------|----|---------|---------|
| Local | `wrangler dev` | Base locale fictive | À la main |
| Recette (`staging`) | Compte Cloudflare « Plootos Staging », `app.plootos-staging.workers.dev` derrière Access | Fictives | À chaque demande de fusion, et après chaque « Merge » sur `main` |
| Production (`production`) | Compte Cloudflare « Plootos Prod », `app.plootos.workers.dev` derrière Access | Réelles | Après « Merge » sur `main`, quand la variable `PRODUCTION_ENABLED` vaut `true` ; « Run workflow » la lance à la main |

Secrets de chaque environnement GitHub (`staging`, `production`) :
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`,
`ALLOWED_USERS` (`{"adresse": "Prénom"}`).

Action « Données de recette » (« Run workflow », sur `main` ou la branche d'un lot) : vide toute
la base de recette, réapplique les migrations et charge un jeu fictif (exemple, exemple au 15/03, 3 ans ou vide).
Elle n'a accès qu'à la recette. La personne 1 des données est la première adresse de
`ALLOWED_USERS`.

Variable du dépôt : `PRODUCTION_ENABLED` (`true` une fois le compte « Plootos Prod » et ses
secrets en place ; absente, un « Merge » ne déploie rien en production).
