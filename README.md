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
npm run seed -- exemple          # base locale : mois d'exemple (spec 1.3)
npm run seed -- 3-ans [AAAA-MM]  # 36 mois fictifs finissant à ce mois (mars 2027 par défaut)
npm run seed -- vide             # base vide, comme avant la mise en service
```

Date simulée (local et recette seulement ; le champ pour la choisir arrive au lot 5) : dans la
console du navigateur, `localStorage.setItem('plootos.simulatedToday', '2027-03-15')`, puis
recharger ; `localStorage.removeItem('plootos.simulatedToday')` pour revenir à aujourd'hui.
En local et en recette, une ligne en bas de page donne le volume chargé, les temps de
chargement et la date du jour du serveur.

## Base, lecture, écriture

| Point | Où |
|-------|----|
| Lecture | `GET /api/data` : tout sauf les opérations, et le nombre de pages ; `GET /api/data/operations/:page` : 1 000 opérations et leurs parts. L'appli lit les pages en parallèle et relit tout si une page cite un élément inconnu. SQLite construit le JSON par paquets de 200 rangées (`worker/src/read.ts`) ; les auteurs y sont des prénoms, jamais des adresses |
| Écriture | `WriteBatch` (`worker/src/write.ts`) : un lot D1 tout-ou-rien ; auteur et dates remplis ; `row_version` vérifié par une « garde » dans le lot (conflit : 409 `conflict` avec les éléments modifiés) ; refus pendant une restauration |
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
la base de recette, réapplique les migrations et charge un jeu fictif (exemple, 3 ans ou vide).
Elle n'a accès qu'à la recette. La personne 1 des données est la première adresse de
`ALLOWED_USERS`.

Variable du dépôt : `PRODUCTION_ENABLED` (`true` une fois le compte « Plootos Prod » et ses
secrets en place ; absente, un « Merge » ne déploie rien en production).
