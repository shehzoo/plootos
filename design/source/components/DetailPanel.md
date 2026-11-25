# DetailPanel

Panneau de détail d'une catégorie sur ordinateur : ses chiffres, ses lignes de budget du mois et ses opérations.

## Ce que fournit l'appli
La catégorie, sa section, prévu, réel et reste, les lignes de budget qui s'appliquent ce mois-là (surcharges et motifs), les opérations du mois.

## Règles
- Largeur `size-detail`, fond `surface-card`, filet `line` à gauche ; s'ouvre en `duration-slow`.
- Chiffres en `amount-m` ; titre en `title-m` ; intitulés de groupe en `title-s`.
- Opération : date en `ink-muted`, libellé, montant à droite avec « − » pour une sortie ; la précision (sous-catégorie, répartition) en `caption`.
- Sur téléphone, le même contenu s'ouvre en plein écran.
