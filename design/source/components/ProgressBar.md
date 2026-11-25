# ProgressBar

Barre d'avancement d'une catégorie : la part du prévu déjà consommée.

## Ce que fournit l'appli
Le réel et le prévu ; la barre calcule `min(100 %, réel / prévu)`.

## Règles
- `pl-bar--over` quand le réel dépasse le prévu d'une sortie : barre pleine en `over`, toujours avec le texte « dépassé de X € ».
- Pas de barre pour une catégorie soldée, une catégorie hors budget ou une sous-catégorie « dans Courses ».
- `role="progressbar"` avec `aria-valuenow`, ou un texte équivalent dans la rangée.
