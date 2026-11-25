# BudgetTable

Tableau du mois sur ordinateur : une ligne par section, catégorie et sous-catégorie, avec prévu, réel, reste et avancement.

## Ce que fournit l'appli
Les sections dans leur ordre, leurs catégories et sous-catégories visibles ce mois-là, et pour chacune prévu, réel et reste (C3 à C5, C10).

## Règles
- Ligne de section sur `surface-sunk`, en `title-s`, repliable (bouton `aria-expanded`, chevron qui tourne en `duration-base`) ; à droite, « reste X € », les dépassements en `over`, « hors budget » le cas échéant.
- Montants à droite, en `table`, chiffres alignés.
- Sous-catégorie en retrait `space-6` ; prévu et reste en `ink-muted` (ils ne s'additionnent pas à la catégorie) ; « dans Courses » à la place du prévu quand elle n'a pas de ligne propre.
- Reste : montant seul, « soldé » en `ink-muted`, « dépassé de X € » en `over`, « reçu en plus X € » en `primary` pour une entrée.
- Une rangée cliquable ouvre le `DetailPanel` ; la rangée ouverte est sur `surface-selected`.
