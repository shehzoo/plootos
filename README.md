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
| `scripts/` | Chargement des données fictives, secrets du déploiement, étapes des actions d'exploitation |
| `integration/` | Tests du code de l'appli contre le Worker et une base locale (export et restauration), et des étapes d'exploitation |
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
npm run seed -- exemple-sans-operations  # le mois d'exemple sans ses opérations, à saisir ou importer
npm run seed -- cas-a-b          # le mois d'exemple et l'opération du cas B (spec 1.4), pour rejouer les cas A et B
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
| Écritures des lignes de budget (lot 8) | `worker/src/lines.ts` : `POST /api/budget-lines` (création, calée sur le mois de début), `PATCH /api/budget-lines/:id` (nom, et/ou nouvelle version à partir d'un mois, R3), `…/archive` (dernier mois, R4), `…/override` et `…/override/remove` (surcharge d'un mois en cours ou à venir ; changer une surcharge la retire et en crée une nouvelle). Le Worker calcule le changement avec les mêmes fonctions pures que l'appli (`shared/src/engine/versions.ts`) ; le lot est gardé par le `row_version` de la ligne, que toute écriture sur ses versions et surcharges augmente. Côté appli : `web/src/budget/lines.ts` (aperçu avant confirmation) et `web/src/budget/LineEditor.tsx` (panneaux et fenêtre de surcharge, sur ordinateur seulement) |
| Écritures des opérations (lot 9) | `worker/src/operations.ts` : `POST /api/operations` (ajout manuel de plusieurs opérations, tout-ou-rien ; R5 refusé sans `confirmDuplicate`, R6 et décembre N+3), `PATCH /api/operations/:id` (fiche : parts, commentaire ; pour une saisie, montant et date de valeur, la première part prenant l'écart), `POST /api/operations/categorize` (« Enregistrer N opérations » et « Mettre dans… », tout-ou-rien), `POST /api/operations/:id/delete` (une saisie seulement, archivée). Catégorie choisissable (R2) vérifiée par une garde ; une part garde une catégorie que l'opération avait déjà (« sans détail ») ; réduire une répartition efface les parts en trop. Le lot est gardé par le `row_version` de chaque opération, que toute écriture sur ses parts augmente. Côté appli : `web/src/operations/entry.ts` (fonctions pures), `CategoryField` (le champ de recherche de catégorie, le même partout), `ManualEntry`, `RecordEditor`, `SplitDialog`, `CategorizeScreen` |
| Import et vérification du solde (lot 10) | Le relevé XLSX est lu dans le navigateur (`read-excel-file`, puis `shared/src/statement.ts`) : seuls les opérations et le « Solde au » sont envoyés. `worker/src/imports.ts` : `POST /api/import/preview` trie (R6, R8, R9, fonction partagée `sortImport`) contre les opérations des mêmes dates de valeur et donne C7 à la date du relevé ; `POST /api/import` refait le tri (s'il a changé : 409 `import_changed` avec le nouveau tri, rien n'est écrit), puis écrit en un seul lot les nouvelles opérations, les fusions et la vérification du solde ; des gardes vérifient que rien n'a bougé entre-temps, et l'index unique des opérations importées empêche tout doublon. `POST /api/balance-checks` : vérification manuelle, au jour même. R8 compare les libellés sans casse ni accents. Côté appli : `web/src/operations/ImportScreen.tsx` (`/operations/importer`), `BalanceCheck.tsx`, `importing.ts` |
| Export et restauration (lot 11) | Export : l'appli relit tout (mêmes requêtes par pages qu'à l'ouverture), construit le fichier JSON (`shared/src/backup.ts` : format, version du schéma, date, auteur par son prénom, environnement, chaque table avec ses colonnes), le télécharge, puis `POST /api/exports` note la date (rappel sur le mois en cours au-delà d'un mois, ou d'un mois après la mise en service sans export). Restauration (`worker/src/restore.ts`, `POST /api/restore`) : base vide seulement, export du même type d'environnement (production vers production), schéma plus ancien converti par `EXPORT_MIGRATIONS` (une conversion par migration, vérifiée par un test), plus récent refusé ; lots envoyés l'un après l'autre (2 000 rangées au plus), le premier pose `meta.restore_in_progress`, le dernier écrit le solde initial, vérifie le nombre de rangées de chaque table et retire le marqueur ; tant qu'il est posé, tout le reste est refusé et l'appli affiche « Restauration inachevée ». Identifiants, versions et traçabilité de l'export gardés ; chaque prénom redevient l'adresse autorisée qui le porte (« ? » sinon). Côté appli : `web/src/budget/backup.ts`, `SetupScreen`, `DataScreen` |
| Vérifier un vrai relevé (spec 4.9) | `scripts/verifier-releve.ts`, compilé en un seul fichier (`npx esbuild scripts/verifier-releve.ts --bundle --platform=node --format=esm --outfile=verifier-releve.mjs`), lancé sur l'ordinateur où sont les relevés : il n'affiche que des oui/non et des nombres ; avec deux relevés, il dit si le « Solde au » est en date d'opération ou de valeur |
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
la base de recette, réapplique les migrations et charge un jeu fictif (exemple, exemple au 15/03, exemple sans opérations, cas A et B, 3 ans ou vide).
Elle n'a accès qu'à la recette. La personne 1 des données est la première adresse de
`ALLOWED_USERS`.

Actions d'exploitation (« Run workflow », recette ou production ; production depuis `main`
seulement), qui n'affichent que des marque-pages, jamais de données (`scripts/exploitation.ts`) :

| Action | Ce qu'elle fait | Confirmation |
|--------|-----------------|--------------|
| Vider la base | Note un marque-page (annulable 7 jours), supprime toutes les tables, historique des migrations compris, puis réapplique les migrations : l'appli s'ouvre sur la mise en service | Taper `VIDER` |
| Restaurer à une date | Ramène toute la base à un point des 7 derniers jours (D1 Time Travel) : date et heure de Paris (`AAAA-MM-JJ HH:MM`) ou marque-page ; réapplique ensuite les migrations ; affiche le marque-page qui annule | Taper `RESTAURER` |

Variable du dépôt : `PRODUCTION_ENABLED` (`true` une fois le compte « Plootos Prod » et ses
secrets en place ; absente, un « Merge » ne déploie rien en production).
