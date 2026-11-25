Plootos est l'appli de budget d'une famille : deux personnes, un compte commun, un mois à la fois. Elle se consulte plusieurs fois par semaine, souvent sur téléphone, et doit rassurer plutôt qu'alarmer. Le système est sobre : un vert sauge pour la marque, des neutres légèrement verts, une seule couleur d'alerte. Les chiffres sont la matière principale : ils sont grands, alignés et lisibles d'un coup d'œil.

Principes :
- Le chiffre d'abord. Un écran répond à une question (« combien il me reste ? ») par un nombre ; le reste l'explique.
- Le calme par défaut. La couleur signale ce qui demande une action : un dépassement (`over`), une opération à catégoriser (`warn`). Tout le reste est neutre ou sauge.
- Les mots portent le sens. Une couleur d'état est toujours accompagnée de ses mots (« dépassé de 12 € », « 2 à catégoriser »).
- Clair et sombre sont la même appli. Chaque couleur a sa valeur dans les deux thèmes ; aucune valeur écrite en dur.

## Couleurs

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

## Typographie

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

## Mise en page et espacements

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

## Formes

- Coins : `radius-m` pour les commandes et les cases, `radius-s` pour les petits éléments, `radius-l` pour le bandeau seulement, `radius-full` pour les barres, le bouton + et les pastilles.
- Le tableau et les listes ne sont pas des cartes : rangées séparées par des filets `line`, sections sur `surface-sunk`, sans bord ni coin.
- Barres d'avancement : épaisseur `size-bar`, extrémités rondes, remplissage plafonné à 100 % ; au-delà, la barre entière passe en `over`.

## Élévation

- Plat par défaut : surfaces et filets, pas d'ombre.
- `shadow-float` seulement pour ce qui flotte : bouton + flottant, menu ouvert, fenêtre. Une fenêtre pose aussi un voile `ink` à 40 % sur la page.

## Mouvement

- Un mouvement montre un changement que la personne a provoqué : déplier une section, ouvrir un détail, changer de mois. Rien ne bouge tout seul.
- Durées `duration-fast` (survol, appui), `duration-base` (dépliage, barre, changement de mois), `duration-slow` (panneau de détail) ; courbe `easing-standard`.
- Avec `prefers-reduced-motion: reduce`, aucun déplacement ni dépliage animé : l'état change d'un coup.

## Ton et contenu

L'appli parle aux deux adultes du foyer, en français, avec le tutoiement. Elle constate et guide, sans juger.

- Phrases courtes, voix active, casse de phrase, pas de point d'exclamation, pas d'emoji.
- Le vocabulaire de la spec, toujours le même mot pour la même chose : importer, saisir, fusionner, catégoriser, à catégoriser, répartir, vérification du solde, soldé, dépassé de, reçu en plus, hors budget, « dans Courses ».
- Un bouton dit ce qu'il fait : « Enregistrer », « + Ajout manuel », « Importer relevé bancaire (XLSX) », « Catégoriser ». La confirmation reprend le même verbe : « Enregistré ».
- Un dépassement se dit sans reproche : « dépassé de 12 € », jamais « Attention ! ».
- Une erreur dit ce qui s'est passé et quoi faire : « Pas de connexion. Tes modifications ne sont pas enregistrées : réessaie quand le réseau revient. »
- Un écran vide invite à agir : « Aucune opération ce mois-ci. Importe le relevé ou fais un ajout manuel. »

## Iconographie

Peu d'icônes : le texte porte le sens. Quatre icônes en v1, dans `assets/Icones/` : chevron gauche, chevron droit, chevron bas, plus.

- Trait de 2 px sur une grille de 24 px, extrémités et angles arrondis.
- Dans l'appli, insère le SVG dans la page et remplace son encre `#1c2620` par `currentColor` : l'icône prend la couleur du texte (`ink-muted` dans une rangée, `on-band` dans le bandeau, `on-primary` dans le bouton +).
- Une icône seule (flèches de mois, bouton +) porte un nom accessible : « Mois précédent », « Mois suivant », « Ajout manuel ».
- Pas de bibliothèque d'icônes en v1 ; une icône nouvelle suit les mêmes règles de trait.

## Logo et icône

Le logo est le nom « plootos » en minuscules, en Figtree 700, approche `-0.04em` : `assets/Logo/plootos-mot-sauge.svg` sur `surface-card` ou `surface-page` en clair, `assets/Logo/plootos-mot-clair.svg` sur `band` et en sombre.

- Icône provisoire de l'appli : `assets/Logo/plootos-icone.svg`, le mot en blanc sur `primary`, coins de 22 %. Elle donne les fichiers du manifeste (192 px, 512 px, et une version pleine pour l'icône masquable, mot dans la zone sûre de 80 %).
- À 48 px, sur l'écran d'accueil, le mot entier reste petit : c'est assumé jusqu'à la vraie icône.
- Ne redessine pas le mot avec une autre police, ne le colore pas autrement qu'en `primary` ou blanc, ne l'écris pas avec une capitale.

## Ordinateur et téléphone

Même système, deux présentations. Le téléphone est en lecture seule en v1, sauf l'ajout manuel.

| Élément | Ordinateur | Téléphone |
|---|---|---|
| Navigation | `SideNav` à gauche | `BottomNav` en bas |
| Bandeau | Mois, flèches, deux boutons, trois cases | Mois, flèches, deux cases |
| Corps du mois | `BudgetTable` | Liste de `CategoryItem` par section |
| Détail | `DetailPanel` à droite | Écran à part |
| Ajout manuel | Bouton du bandeau | `Fab` sur Mois et Opérations |

## À faire et à éviter

- Fais : un seul bouton plein par zone ; les deux soldes toujours dans le bandeau ; « dépassé de X € » en mots et en `over` ; un état vide qui propose l'action.
- Évite : une couleur sans mots pour dire un état ; une ombre sur une surface plate ; `primary` comme fond d'un grand aplat hors du bandeau et du bouton + ; du texte en dessous de 12,5 px ; une valeur de couleur écrite en dur au lieu d'un jeton.
