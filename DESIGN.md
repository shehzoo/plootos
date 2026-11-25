---
version: alpha
name: Plootos
description: "Design system de Plootos, l'appli de budget familial : sauge, Figtree, chiffres d'abord, clair et sombre."
colors:
  light:
    surface-page: "#f4f6f2"
    surface-card: "#ffffff"
    surface-sunk: "#eef2ec"
    surface-selected: "#e3ece6"
    line: "#dfe5dc"
    line-strong: "#7f8c83"
    ink: "#1c2620"
    ink-muted: "#56635a"
    primary: "#3f6f5a"
    on-primary: "#ffffff"
    progress: "#5b8f76"
    progress-track: "#e3e9e1"
    band: "#3f6f5a"
    on-band: "#ffffff"
    on-band-muted: "#dce8e1"
    band-line: "#7fa08f"
    over: "#b5452e"
    over-soft: "#f8e6e1"
    warn: "#875c00"
    warn-soft: "#f6ecd6"
    focus: "#3f6f5a"
    focus-on-band: "#ffffff"
  dark:
    surface-page: "#111613"
    surface-card: "#19201c"
    surface-sunk: "#202823"
    surface-selected: "#233129"
    line: "#2b352f"
    line-strong: "#6b7a70"
    ink: "#e8efe9"
    ink-muted: "#a0ada4"
    primary: "#8fc4a8"
    on-primary: "#111613"
    progress: "#7fb89b"
    progress-track: "#2b352f"
    band: "#24392e"
    on-band: "#e8efe9"
    on-band-muted: "#b5c7bc"
    band-line: "#4a6758"
    over: "#f08b72"
    over-soft: "#3a1f18"
    warn: "#e8bb63"
    warn-soft: "#33291a"
    focus: "#8fc4a8"
    focus-on-band: "#e8efe9"
typography:
  amount-xl:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
    fontFeature: "\"tnum\" 1"
  amount-l:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.01em
    fontFeature: "\"tnum\" 1"
  amount-m:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: "\"tnum\" 1"
  title-l:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 26px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.015em
    fontFeature: "\"tnum\" 1"
  title-m:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.01em
    fontFeature: "\"tnum\" 1"
  title-s:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.35
    fontFeature: "\"tnum\" 1"
  body:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"tnum\" 1"
  table:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.35
    fontFeature: "\"tnum\" 1"
  caption:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "\"tnum\" 1"
  wordmark:
    fontFamily: "Figtree, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif"
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.04em
    fontFeature: "\"tnum\" 1"
rounded:
  s: 6px
  m: 8px
  l: 16px
  full: 999px
spacing:
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-5: 20px
  space-6: 24px
  space-8: 32px
  space-10: 40px
motion:
  fast:
    duration: 120ms
    timingFunction: "cubic-bezier(0.2, 0, 0, 1)"
  base:
    duration: 200ms
    timingFunction: "cubic-bezier(0.2, 0, 0, 1)"
  slow:
    duration: 280ms
    timingFunction: "cubic-bezier(0.2, 0, 0, 1)"
components:
  button-primary:
    backgroundColor: "{colors.light.primary}"
    textColor: "{colors.light.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.m}"
    height: 36px
    padding: 16px
  button-secondary:
    backgroundColor: "{colors.light.surface-card}"
    textColor: "{colors.light.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.m}"
    height: 36px
    padding: 16px
  month-band:
    backgroundColor: "{colors.light.band}"
    textColor: "{colors.light.on-band}"
    rounded: "{rounded.l}"
    padding: 20px
  progress-bar:
    backgroundColor: "{colors.light.progress-track}"
    textColor: "{colors.light.progress}"
    rounded: "{rounded.full}"
    height: 6px
  status-pill-warn:
    backgroundColor: "{colors.light.warn-soft}"
    textColor: "{colors.light.warn}"
    rounded: "{rounded.full}"
    height: 22px
  fab:
    backgroundColor: "{colors.light.primary}"
    textColor: "{colors.light.on-primary}"
    rounded: "{rounded.full}"
    size: 56px
---

<!-- Généré depuis design/source/ par `npm run design`. Ne pas modifier : changer le design system dans son artefact, recopier ses fichiers, relancer. -->

## Overview

Plootos est l'appli de budget d'une famille : deux personnes, un compte commun, un mois à la fois. Elle se consulte plusieurs fois par semaine, souvent sur téléphone, et doit rassurer plutôt qu'alarmer. Le système est sobre : un vert sauge pour la marque, des neutres légèrement verts, une seule couleur d'alerte. Les chiffres sont la matière principale : ils sont grands, alignés et lisibles d'un coup d'œil.

Principes :
- Le chiffre d'abord. Un écran répond à une question (« combien il me reste ? ») par un nombre ; le reste l'explique.
- Le calme par défaut. La couleur signale ce qui demande une action : un dépassement (`over`), une opération à catégoriser (`warn`). Tout le reste est neutre ou sauge.
- Les mots portent le sens. Une couleur d'état est toujours accompagnée de ses mots (« dépassé de 12 € », « 2 à catégoriser »).
- Clair et sombre sont la même appli. Chaque couleur a sa valeur dans les deux thèmes ; aucune valeur écrite en dur.

## Colors

Deux thèmes, `light` (Clair) et `dark` (Sombre), qui suivent le réglage de l'appareil.

Surfaces, du fond vers l'avant :
- Pose la page sur `surface-page`, les panneaux, champs et cases sur `surface-card`, les lignes de section sur `surface-sunk`, l'élément actif ou sélectionné sur `surface-selected`.
- Sépare par des filets `line`, jamais par des ombres sur une surface plate. Les bords qui délimitent une commande (champ, case, bouton secondaire) utilisent `line-strong`.

Texte :
- Écris en `ink`, et le secondaire en `ink-muted` : intitulés, dates, reste d'une sous-catégorie (gris, car il ne s'ajoute pas à celui de sa catégorie), « dans Courses », « soldé ».
- N'utilise jamais `primary` pour un long texte : seulement les liens, les actions et « reçu en plus ».

Marque :
- `primary` sert aux actions principales : bouton plein (texte `on-primary`), bouton + flottant, onglet actif, liens. Un seul bouton plein par zone.
- Les barres d'avancement se remplissent en `progress` sur `progress-track`. Une catégorie soldée n'a pas de barre.

Bandeau du mois :
- En tête du mois en cours, du mois terminé et de la projection, le bandeau `band` porte le mois, ses flèches, les boutons d'action et les deux soldes. Texte en `on-band`, secondaire en `on-band-muted`, bords décoratifs en `band-line`. Sur `band`, le bouton plein est `on-band` avec un texte `band` ; l'anneau de focus devient `focus-on-band`.
- En sombre, `band` est un sauge profond : jamais l'aplat clair de `primary`.

États :
- Dépassement : `over`, pour le texte « dépassé de X € », la barre dépassée et le nombre de dépassements. Fond éventuel en `over-soft`. Pour une entrée, « reçu en plus » reste en `primary`, pas en `over`.
- À catégoriser, solde « Approximatif » : `warn`, fond de bandeau `warn-soft`.
- `over` et `progress` ont presque la même clarté : la différence passe par les mots, pas seulement par la teinte (lecture sûre pour les daltoniens).

Focus :
- Chaque élément qu'on peut atteindre au clavier montre un anneau `focus` de 2 px plein, décalé de 2 px ; sur `band`, `focus-on-band`.

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| `surface-page` | #f4f6f2 | #111613 | Fond de page de l'appli, derrière le tableau, les panneaux et la liste du téléphone. |
| `surface-card` | #ffffff | #19201c | Panneau de détail, cases des soldes hors bandeau, champs, menus, boutons secondaires. |
| `surface-sunk` | #eef2ec | #202823 | Ligne de section du tableau (ordinateur) et en-tête de section de la liste (téléphone). |
| `surface-selected` | #e3ece6 | #233129 | Entrée active de la navigation latérale, rangée sélectionnée du tableau. |
| `line` | #dfe5dc | #2b352f | Filets décoratifs : séparateurs de rangées et de panneaux. Ne porte pas de sens : contraste non tenu à 3:1. |
| `line-strong` | #7f8c83 | #6b7a70 | Bord des champs, des cases à cocher et des boutons secondaires : 3:1 au moins sur surface-card et surface-page dans les deux thèmes. |
| `ink` | #1c2620 | #e8efe9 | Texte principal et chiffres, sur surface-page, surface-card, surface-sunk et surface-selected (12:1 au moins). |
| `ink-muted` | #56635a | #a0ada4 | Texte secondaire : intitulés de colonne, dates, « réel sur prévu », reste d'une sous-catégorie, « dans Courses », « soldé ». Sur les quatre surfaces : 5.2:1 au moins. |
| `primary` | #3f6f5a | #8fc4a8 | Couleur de Plootos : bouton principal, bouton + flottant, onglet actif du téléphone, liens, « reçu en plus ». Lisible comme texte sur les quatre surfaces (4.8:1 au moins). |
| `on-primary` | #ffffff | #111613 | Texte et icône posés sur primary (5.8:1 en clair, 9.3:1 en sombre). |
| `progress` | #5b8f76 | #7fb89b | Remplissage des barres d'avancement : 3:1 sur progress-track et sur surface-card. |
| `progress-track` | #e3e9e1 | #2b352f | Rail des barres d'avancement. |
| `band` | #3f6f5a | #24392e | Bandeau en tête du mois : il porte le mois, les flèches, les boutons et les deux soldes. Sauge profond en sombre, pour ne pas éblouir. |
| `on-band` | #ffffff | #e8efe9 | Texte, chiffres et bouton plein sur band (5.8:1 en clair, 10.6:1 en sombre). |
| `on-band-muted` | #dce8e1 | #b5c7bc | Texte secondaire sur band : intitulés des soldes, « Vérifié le… » (4.6:1 en clair, 7:1 en sombre). |
| `band-line` | #7fa08f | #4a6758 | Bord décoratif des cases de solde et des boutons secondaires sur band ; ne porte pas de sens. |
| `over` | #b5452e | #f08b72 | Dépassement : « dépassé de X € », barre dépassée, nombre de dépassements d'une section. Toujours avec ces mots : la couleur seule ne suffit pas (même clarté que progress). 4.5:1 au moins sur les quatre surfaces. |
| `over-soft` | #f8e6e1 | #3a1f18 | Fond d'un bandeau ou d'une pastille de dépassement, avec over pour le texte (4.5:1). |
| `warn` | #875c00 | #e8bb63 | À catégoriser et « Approximatif » : texte, bord de pastille. 4.8:1 au moins sur les quatre surfaces. |
| `warn-soft` | #f6ecd6 | #33291a | Fond du bandeau « à catégoriser », avec warn pour le texte (5:1). |
| `focus` | #3f6f5a | #8fc4a8 | Anneau de focus clavier, 2 px plein, décalé de 2 px : 5:1 au moins sur toutes les surfaces sauf band. |
| `focus-on-band` | #ffffff | #e8efe9 | Anneau de focus sur band, où focus disparaîtrait. |

## Typography

Une seule famille, Figtree (licence SIL OFL), auto-hébergée : `fonts/figtree-latin-wght-normal.woff2` pour le français, `fonts/figtree-latin-ext-wght-normal.woff2` pour les autres lettres latines. Police variable, graisses 300 à 900.

- Écris tout en `--font-sans`. Aucune autre police, aucune italique.
- Les chiffres ont tous la même largeur (`"tnum"` activé dans la police) : les montants s'alignent dans les colonnes sans réglage.
- Chiffres : les soldes du bandeau en `amount-xl` (ordinateur) ou `amount-l` (téléphone) ; les chiffres du panneau de détail en `amount-m`.
- Titres : le titre d'écran en `title-l` sur ordinateur et `title-m` sur téléphone ; les lignes de section en `title-s`.
- Texte : `body` pour les phrases, `table` pour les rangées, `label` pour les intitulés et les boutons, `caption` pour les précisions. Rien en dessous de `caption` (12,5 px).
- Graisses : 400 pour le texte, 500 pour les intitulés et boutons, 600 pour les chiffres et sections, 700 pour les titres et le mot-symbole.
- Casse de phrase partout : « Solde prévu au 31/03 », jamais de capitales pour un intitulé.

Écriture des nombres :
- Montant en euros, sans décimales quand elles sont nulles : « 1 200 € », espace insécable fine entre milliers (`Intl.NumberFormat('fr-FR')`), espace insécable avant « € ».
- Centimes seulement quand ils existent : « 42,50 € ».
- Un montant affiché est sans signe ; le sens se lit dans la colonne ou le mot (« dépassé de », « reçu en plus »). Dans une liste d'opérations, une sortie prend le signe moins typographique « − » (U+2212), une entrée « + ».
- Dates courtes « 12/03 », mois « Mars 2027 », date complète « 12/03/2027 ».

## Layout

Pas de 4 px : `space-1` à `space-10`. Toute marge ou tout écart en est un multiple.

Ordinateur (au-dessus de `size-phone-max`) :
- Trois colonnes : navigation `size-sidebar`, contenu, panneau de détail `size-detail` quand une catégorie est ouverte.
- Contenu : marges `space-6`. En tête, le bandeau du mois ; dessous, le tableau, écart `space-4`.
- Tableau : colonnes Catégorie, Prévu, Réel, Reste, Avancement ; montants alignés à droite ; rangées de `size-row` au moins ; sous-catégories en retrait de `space-6`.

Téléphone (en dessous de `size-phone-max`, quel que soit l'appareil) :
- Une colonne, marges `space-4`, barre du bas `size-bottom-nav` plus la marge de sécurité de l'écran (`env(safe-area-inset-bottom)`).
- Le bandeau touche les bords et le haut ; seuls ses coins du bas sont arrondis.
- La liste réserve sous son dernier élément la place du bouton + flottant (`size-fab` + `space-4` × 2) : rien n'est caché dessous.
- Toute cible tactile mesure au moins `size-target`.

- `size-sidebar` : 196px. Largeur de la navigation latérale (ordinateur).
- `size-detail` : 300px. Largeur du panneau de détail à droite (ordinateur).
- `size-phone-max` : 760px. Seuil : en dessous, l'appli prend la présentation téléphone, quel que soit l'appareil (lot 1).
- `size-row` : 40px. Hauteur minimale d'une rangée du tableau (ordinateur).
- `size-target` : 44px. Taille minimale de toute cible tactile sur téléphone.
- `size-control` : 36px. Hauteur d'un bouton ou d'une bascule sur ordinateur ; 44px sur téléphone.
- `size-bar` : 6px. Épaisseur d'une barre d'avancement.
- `size-fab` : 56px. Diamètre du bouton + flottant.
- `size-bottom-nav` : 64px. Hauteur de la barre du bas (téléphone), hors marge de sécurité de l'écran.

Même système, deux présentations. Le téléphone est en lecture seule en v1, sauf l'ajout manuel.

| Élément | Ordinateur | Téléphone |
|---|---|---|
| Navigation | `SideNav` à gauche | `BottomNav` en bas |
| Bandeau | Mois, flèches, deux boutons, trois cases | Mois, flèches, deux cases |
| Corps du mois | `BudgetTable` | Liste de `CategoryItem` par section |
| Détail | `DetailPanel` à droite | Écran à part |
| Ajout manuel | Bouton du bandeau | `Fab` sur Mois et Opérations |

## Elevation & Depth

- Plat par défaut : surfaces et filets, pas d'ombre.
- `shadow-float` seulement pour ce qui flotte : bouton + flottant, menu ouvert, fenêtre. Une fenêtre pose aussi un voile `ink` à 40 % sur la page.

- `shadow-float` : clair `0 2px 8px rgba(28, 38, 32, 0.18)`, sombre `0 2px 10px rgba(0, 0, 0, 0.55)`. Seulement ce qui flotte au-dessus du contenu : bouton + flottant, menu ouvert, fenêtre.

## Shapes

- Coins : `radius-m` pour les commandes et les cases, `radius-s` pour les petits éléments, `radius-l` pour le bandeau seulement, `radius-full` pour les barres, le bouton + et les pastilles.
- Le tableau et les listes ne sont pas des cartes : rangées séparées par des filets `line`, sections sur `surface-sunk`, sans bord ni coin.
- Barres d'avancement : épaisseur `size-bar`, extrémités rondes, remplissage plafonné à 100 % ; au-delà, la barre entière passe en `over`.

## Motion

- Un mouvement montre un changement que la personne a provoqué : déplier une section, ouvrir un détail, changer de mois. Rien ne bouge tout seul.
- Durées `duration-fast` (survol, appui), `duration-base` (dépliage, barre, changement de mois), `duration-slow` (panneau de détail) ; courbe `easing-standard`.
- Avec `prefers-reduced-motion: reduce`, aucun déplacement ni dépliage animé : l'état change d'un coup.

## Voice & Content Strategy

L'appli parle aux deux adultes du foyer, en français, avec le tutoiement. Elle constate et guide, sans juger.

- Phrases courtes, voix active, casse de phrase, pas de point d'exclamation, pas d'emoji.
- Le vocabulaire de la spec, toujours le même mot pour la même chose : importer, saisir, fusionner, catégoriser, à catégoriser, répartir, vérification du solde, soldé, dépassé de, reçu en plus, hors budget, « dans Courses ».
- Un bouton dit ce qu'il fait : « Enregistrer », « + Ajout manuel », « Importer relevé bancaire (XLSX) », « Catégoriser ». La confirmation reprend le même verbe : « Enregistré ».
- Un dépassement se dit sans reproche : « dépassé de 12 € », jamais « Attention ! ».
- Une erreur dit ce qui s'est passé et quoi faire : « Pas de connexion. Tes modifications ne sont pas enregistrées : réessaie quand le réseau revient. »
- Un écran vide invite à agir : « Aucune opération ce mois-ci. Importe le relevé ou fais un ajout manuel. »

## Components

Styles dans `web/src/design/components.css` (classes `pl-*`), qui n'utilisent que les variables de `web/src/design/tokens.css`.

### AmountField

Champ de montant : intitulé au-dessus, montant aligné à droite, « € » à la suite.

#### Ce que fournit l'appli
L'intitulé, la valeur, le message d'erreur éventuel.

#### Règles
- `inputmode="decimal"`, taille de texte 16 px (pas de zoom automatique sur téléphone), virgule décimale acceptée.
- Bord `line-strong` ; focus en anneau `focus` ; erreur : bord `over` et message en `over` sous le champ, qui dit quoi corriger.


### Banner

Bandeau d'alerte pleine largeur, avec une action : opérations à catégoriser, mois terminé incomplet.

#### Règles
- `pl-banner` (fond `warn-soft`, texte `warn`) pour ce qui attend une action ; `pl-banner--over` seulement pour un problème de solde (écart à la vérification).
- Une phrase qui dit le fait et sa conséquence, puis l'action en lien souligné (« Catégoriser »).
- Sur téléphone (lecture seule), pas d'action : la phrase seule.


### BottomNav

Barre du bas du téléphone : Mois, Opérations, Projection, Budget.

#### Règles
- Hauteur `size-bottom-nav` plus la marge de sécurité de l'écran ; fond `surface-card`, filet `line` en haut.
- Entrée active en `primary`, graisse 700, avec un trait de 3 px en haut : la couleur n'est pas le seul indice.


### BudgetTable

Tableau du mois sur ordinateur : une ligne par section, catégorie et sous-catégorie, avec prévu, réel, reste et avancement.

#### Ce que fournit l'appli
Les sections dans leur ordre, leurs catégories et sous-catégories visibles ce mois-là, et pour chacune prévu, réel et reste (C3 à C5, C10).

#### Règles
- Ligne de section sur `surface-sunk`, en `title-s`, repliable (bouton `aria-expanded`, chevron qui tourne en `duration-base`) ; à droite, « reste X € », les dépassements en `over`, « hors budget » le cas échéant.
- Montants à droite, en `table`, chiffres alignés.
- Sous-catégorie en retrait `space-6` ; prévu et reste en `ink-muted` (ils ne s'additionnent pas à la catégorie) ; « dans Courses » à la place du prévu quand elle n'a pas de ligne propre.
- Reste : montant seul, « soldé » en `ink-muted`, « dépassé de X € » en `over`, « reçu en plus X € » en `primary` pour une entrée.
- Une rangée cliquable ouvre le `DetailPanel` ; la rangée ouverte est sur `surface-selected`.


### Button

Bouton d'action : plein (`primary`) pour l'action principale d'une zone, contour pour les autres, discret pour une action secondaire dans une phrase ou un panneau.

#### Quand l'utiliser
- `pl-btn pl-btn--primary` : l'action pour laquelle la zone existe (« Enregistrer », « + Ajout manuel »). Un seul par zone.
- `pl-btn` : les autres actions (« Annuler », « Importer relevé bancaire (XLSX) », « Surcharger le mois »).
- `pl-btn pl-btn--ghost` : action secondaire dans un panneau (« Voir la ligne »).

#### Ce que fournit l'appli
Le libellé : un verbe, casse de phrase, sans point. Un `<button type="button">`, désactivé par `disabled` quand l'action est impossible, avec la raison écrite à côté.

#### Règles
- Hauteur `size-control` sur ordinateur, `size-target` sur téléphone.
- Sur `band`, le contour passe en `band-line` et le bouton plein en `on-band` avec un texte `band` (règle portée par `.pl-band`).


### CategoryItem

Rangée d'une catégorie sur téléphone : nom, reste, barre, réel sur prévu ; groupée par section.

#### Ce que fournit l'appli
Les mêmes chiffres que le tableau, pour les catégories de niveau 1 seulement ; le détail s'ouvre en plein écran.

#### Règles
- En-tête de section (`pl-sechead`) sur `surface-sunk` : nom en `title-s`, puis le résumé sur sa propre ligne en `caption` (jamais à côté : il ne tient pas).
- Le dépassement d'une sous-catégorie remonte sur la rangée de sa catégorie, à droite de « réel sur prévu ».
- Hauteur au moins `size-target`.


### DetailPanel

Panneau de détail d'une catégorie sur ordinateur : ses chiffres, ses lignes de budget du mois et ses opérations.

#### Ce que fournit l'appli
La catégorie, sa section, prévu, réel et reste, les lignes de budget qui s'appliquent ce mois-là (surcharges et motifs), les opérations du mois.

#### Règles
- Largeur `size-detail`, fond `surface-card`, filet `line` à gauche ; s'ouvre en `duration-slow`.
- Chiffres en `amount-m` ; titre en `title-m` ; intitulés de groupe en `title-s`.
- Opération : date en `ink-muted`, libellé, montant à droite avec « − » pour une sortie ; la précision (sous-catégorie, répartition) en `caption`.
- Sur téléphone, le même contenu s'ouvre en plein écran.


### Fab

Bouton + flottant du téléphone : il ouvre l'ajout manuel, sur Mois et Opérations seulement.

#### Règles
- En bas à droite, à `space-4` des bords, au-dessus de la barre du bas.
- `aria-label="Ajout manuel"`.
- Absent sur un mois futur, sur Projection et sur Budget.
- La liste réserve sous son dernier élément `size-fab` + 2 × `space-4` pour que rien ne soit caché.


### IconButton

Bouton carré qui ne montre qu'une icône : flèches de mois, fermeture d'un panneau.

#### Ce que fournit l'appli
L'icône (SVG en `currentColor`) et un nom accessible (`aria-label`) : « Mois précédent », « Mois suivant », « Fermer ».

#### Règles
- `size-control` de côté sur ordinateur, `size-target` sur téléphone.
- Désactivé quand il n'y a rien avant (le premier mois suivi) : `disabled`.


### MonthBand

Bandeau en tête du mois : le mois et ses flèches, les actions, et les deux soldes ; c'est le premier chiffre qu'on lit.

#### Ce que fournit l'appli
Le mois affiché, l'état des flèches, les soldes (C7 et C8) avec leurs précisions, et sur ordinateur le nombre d'opérations à catégoriser.

#### Règles
- Fond `band`, texte `on-band`, secondaire `on-band-muted`, cases à bord `band-line`.
- Ordinateur : trois cases (Solde de l'appli, Solde prévu, À catégoriser), boutons « Importer relevé bancaire (XLSX) » et « + Ajout manuel ».
- Téléphone (`pl-band--phone`) : deux cases, pas de bouton ; « À catégoriser » devient un `Banner` sous le bandeau, seulement s'il y en a.
- Solde prévu approximatif : ajoute une `StatusPill` « Approximatif » dans sa case.
- Aussi en tête du mois terminé et de la projection, avec leurs propres chiffres.


### ProgressBar

Barre d'avancement d'une catégorie : la part du prévu déjà consommée.

#### Ce que fournit l'appli
Le réel et le prévu ; la barre calcule `min(100 %, réel / prévu)`.

#### Règles
- `pl-bar--over` quand le réel dépasse le prévu d'une sortie : barre pleine en `over`, toujours avec le texte « dépassé de X € ».
- Pas de barre pour une catégorie soldée, une catégorie hors budget ou une sous-catégorie « dans Courses ».
- `role="progressbar"` avec `aria-valuenow`, ou un texte équivalent dans la rangée.


### SegmentedToggle

Bascule entre deux ou trois choix exclusifs, comme Sortie et Entrée à l'ajout manuel sur téléphone.

#### Règles
- Un `aria-pressed="true"` à la fois, en `primary` avec texte `on-primary`.
- Sur ordinateur, l'ajout manuel garde le « + » devant le montant (décision du 2026-11-23) ; la bascule sert au téléphone.


### SideNav

Navigation latérale de l'ordinateur : le mot-symbole, puis Mois, Opérations, Projection, Budget.

#### Règles
- Largeur `size-sidebar`, fond `surface-card`, filet `line` à droite.
- Entrée active : `aria-current="page"`, fond `surface-selected`, graisse 600.
- Le prénom de la personne connectée en bas, en `caption`.
- Logo : `plootos-mot-sauge.svg` en clair, `plootos-mot-clair.svg` en sombre.


### Stat

Case d'un chiffre clé : intitulé, montant, précision ; dans le bandeau ou sur une surface.

#### Ce que fournit l'appli
L'intitulé (`label`), le montant formaté, une précision d'une ligne (`caption`).

#### Règles
- Montant en `amount-xl` sur ordinateur, `amount-l` sur téléphone ; jamais coupé (`white-space: nowrap`).
- Hors bandeau : fond `surface-card`, bord `line`.


### StatusPill

Pastille d'état en un ou deux mots : à catégoriser, dépassement, approximatif.

#### Règles
- `pl-pill--warn` : « 2 à catégoriser » ; `pl-pill--over` : « 3 dépassements » ; `pl-pill--approx` (contour) : « Approximatif ».
- Toujours des mots ; jamais une pastille de couleur seule.


## Iconography

Peu d'icônes : le texte porte le sens. Quatre icônes en v1, dans `assets/Icones/` : chevron gauche, chevron droit, chevron bas, plus.

- Trait de 2 px sur une grille de 24 px, extrémités et angles arrondis.
- Dans l'appli, insère le SVG dans la page et remplace son encre `#1c2620` par `currentColor` : l'icône prend la couleur du texte (`ink-muted` dans une rangée, `on-band` dans le bandeau, `on-primary` dans le bouton +).
- Une icône seule (flèches de mois, bouton +) porte un nom accessible : « Mois précédent », « Mois suivant », « Ajout manuel ».
- Pas de bibliothèque d'icônes en v1 ; une icône nouvelle suit les mêmes règles de trait.

## Logo

Le logo est le nom « plootos » en minuscules, en Figtree 700, approche `-0.04em` : `assets/Logo/plootos-mot-sauge.svg` sur `surface-card` ou `surface-page` en clair, `assets/Logo/plootos-mot-clair.svg` sur `band` et en sombre.

- Icône provisoire de l'appli : `assets/Logo/plootos-icone.svg`, le mot en blanc sur `primary`, coins de 22 %. Elle donne les fichiers du manifeste (192 px, 512 px, et une version pleine pour l'icône masquable, mot dans la zone sûre de 80 %).
- À 48 px, sur l'écran d'accueil, le mot entier reste petit : c'est assumé jusqu'à la vraie icône.
- Ne redessine pas le mot avec une autre police, ne le colore pas autrement qu'en `primary` ou blanc, ne l'écris pas avec une capitale.

### Logo

- `plootos-mot-sauge.svg` : le mot « plootos », Figtree 700, approche -0.04em, encre `primary` clair (#3f6f5a). Sur `surface-card` et `surface-page` en thème clair.
- `plootos-mot-clair.svg` : le même mot en blanc (#ffffff). Sur `band`, et sur les surfaces du thème sombre.
- `plootos-icone.svg` : icône provisoire de l'appli, 512 px, mot blanc sur `primary` (#3f6f5a), coins de 112 px (22 %). Source des icônes du manifeste.

Les lettres sont vectorisées depuis Figtree : le fichier ne dépend d'aucune police.

### Icônes

Quatre icônes à trait, grille de 24 px, trait de 2 px, extrémités et angles arrondis. Encre du fichier : `ink` clair (#1c2620). Dans l'appli, insère le SVG dans la page et remplace l'encre par `currentColor`.

- `chevron-gauche.svg` : mois précédent.
- `chevron-droite.svg` : mois suivant.
- `chevron-bas.svg` : section dépliée (tourné de -90° quand elle est repliée).
- `plus.svg` : ajout manuel (bouton + flottant).

### Police

Figtree, de Erik Kennedy, sous licence SIL Open Font License 1.1 (`OFL.txt`) : libre d'usage, d'auto-hébergement et de redistribution avec l'appli. Fichiers variables (graisses 300 à 900) dans `fonts/`, découpés en deux plages : latin (français) et latin étendu. Source : paquet `@fontsource-variable/figtree` 5.3.0.

## Do's and Don'ts

- Fais : un seul bouton plein par zone ; les deux soldes toujours dans le bandeau ; « dépassé de X € » en mots et en `over` ; un état vide qui propose l'action.
- Évite : une couleur sans mots pour dire un état ; une ombre sur une surface plate ; `primary` comme fond d'un grand aplat hors du bandeau et du bouton + ; du texte en dessous de 12,5 px ; une valeur de couleur écrite en dur au lieu d'un jeton.
