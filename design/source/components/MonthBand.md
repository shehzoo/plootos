# MonthBand

Bandeau en tête du mois : le mois et ses flèches, les actions, et les deux soldes ; c'est le premier chiffre qu'on lit.

## Ce que fournit l'appli
Le mois affiché, l'état des flèches, les soldes (C7 et C8) avec leurs précisions, et sur ordinateur le nombre d'opérations à catégoriser.

## Règles
- Fond `band`, texte `on-band`, secondaire `on-band-muted`, cases à bord `band-line`.
- Ordinateur : trois cases (Solde de l'appli, Solde prévu, À catégoriser), boutons « Importer relevé bancaire (XLSX) » et « + Ajout manuel ».
- Téléphone (`pl-band--phone`) : deux cases, pas de bouton ; « À catégoriser » devient un `Banner` sous le bandeau, seulement s'il y en a.
- Solde prévu approximatif : ajoute une `StatusPill` « Approximatif » dans sa case.
- Aussi en tête du mois terminé et de la projection, avec leurs propres chiffres.
