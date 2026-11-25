# IconButton

Bouton carré qui ne montre qu'une icône : flèches de mois, fermeture d'un panneau.

## Ce que fournit l'appli
L'icône (SVG en `currentColor`) et un nom accessible (`aria-label`) : « Mois précédent », « Mois suivant », « Fermer ».

## Règles
- `size-control` de côté sur ordinateur, `size-target` sur téléphone.
- Désactivé quand il n'y a rien avant (le premier mois suivi) : `disabled`.
