# Button

Bouton d'action : plein (`primary`) pour l'action principale d'une zone, contour pour les autres, discret pour une action secondaire dans une phrase ou un panneau.

## Quand l'utiliser
- `pl-btn pl-btn--primary` : l'action pour laquelle la zone existe (« Enregistrer », « + Ajout manuel »). Un seul par zone.
- `pl-btn` : les autres actions (« Annuler », « Importer relevé bancaire (XLSX) », « Surcharger le mois »).
- `pl-btn pl-btn--ghost` : action secondaire dans un panneau (« Voir la ligne »).

## Ce que fournit l'appli
Le libellé : un verbe, casse de phrase, sans point. Un `<button type="button">`, désactivé par `disabled` quand l'action est impossible, avec la raison écrite à côté.

## Règles
- Hauteur `size-control` sur ordinateur, `size-target` sur téléphone.
- Sur `band`, le contour passe en `band-line` et le bouton plein en `on-band` avec un texte `band` (règle portée par `.pl-band`).
