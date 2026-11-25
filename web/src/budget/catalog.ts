// What the categories screen shows (spec 3.7): sections, categories and subcategories in their
// order, archived ones left out, with the active budget lines of each (R4: they block archiving).

import type { Direction, Month } from '../../../shared/src/engine'
import type { AppData } from '../../../shared/src/wire'
import { lineErrorText } from './lines'

export interface CatalogItem {
  id: number
  name: string
  rowVersion: number
  /** Active budget lines in this item, its subcategories included (R4). */
  lines: number
}

export interface CatalogCategory extends CatalogItem {
  subs: CatalogItem[]
}

export interface CatalogSection extends CatalogItem {
  direction: Direction
  categories: CatalogCategory[]
}

const byOrder = <T extends { sortOrder: number; id: number }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.id - b.id

/**
 * The lines with a version that is not replaced and that has no end, or ends in `month` or
 * later: the lines R4 calls active (DECISIONS.md, 2026-11-25), per category id.
 */
export function activeLinesByCategory(app: AppData, month: Month): Map<number, Set<number>> {
  const lines = new Map<number, Set<number>>()
  for (const v of app.versions) {
    if (v.replacedAt !== null || (v.endMonth !== null && v.endMonth < month)) continue
    const set = lines.get(v.categoryId) ?? new Set<number>()
    set.add(v.budgetLineId)
    lines.set(v.categoryId, set)
  }
  return lines
}

export function catalogView(app: AppData, month: Month): CatalogSection[] {
  const active = activeLinesByCategory(app, month)
  const count = (ids: number[]) => new Set(ids.flatMap((id) => [...(active.get(id) ?? [])])).size
  const live = app.categories.filter((c) => c.archivedAt === null).sort(byOrder)
  return app.sections
    .filter((s) => s.archivedAt === null)
    .sort(byOrder)
    .map((s) => {
      const categories = live
        .filter((c) => c.sectionId === s.id)
        .map((c) => {
          const subs = live.filter((x) => x.parentId === c.id)
          return {
            id: c.id,
            name: c.name,
            rowVersion: c.rowVersion,
            lines: count([c.id, ...subs.map((x) => x.id)]),
            subs: subs.map((x) => ({ id: x.id, name: x.name, rowVersion: x.rowVersion, lines: count([x.id]) })),
          }
        })
      return {
        id: s.id,
        name: s.name,
        rowVersion: s.rowVersion,
        direction: s.direction,
        categories,
        lines: count(categories.flatMap((c) => [c.id, ...c.subs.map((x) => x.id)])),
      }
    })
}

/** French text of a refusal by the server (fixed codes, spec 4.3). */
export function ruleText(code: string): string {
  switch (code) {
    case 'name_taken':
      return 'Ce nom existe déjà ici.'
    case 'has_active_line':
      return "Il reste des lignes de budget actives : elles doivent d'abord être archivées."
    case 'direction_differs':
      return 'Une catégorie ne change que pour une section de même sens (entrée ou sortie).'
    case 'parent_fixed':
      return 'Une sous-catégorie garde sa catégorie : crées-en une autre et archive l\'ancienne.'
    case 'archived':
      return 'Cet élément est archivé.'
    case 'not_level_one':
      return "Une sous-catégorie n'a pas de sous-catégorie."
    case 'already_set_up':
      return 'La mise en service est déjà faite : recharge la page.'
    case 'not_set_up':
      return "La mise en service n'est pas faite."
    case 'confirmation_required':
      return 'Une confirmation est demandée.'
    case 'restore_in_progress':
      return 'Restauration en cours : réessaie plus tard.'
    case 'not_found':
      return "Cet élément n'existe plus : les données ont été rechargées."
    case 'bad_request':
      return 'Valeur refusée.'
    // Import and balance check (lot 10)
    case 'import_changed':
      return 'Les opérations ont changé entre-temps : recommence l’import.'
    case 'balance_changed':
      return 'Le solde a changé pendant la vérification (une autre écriture) : réessaie.'
    // Operations (lot 9)
    case 'duplicate_unconfirmed':
      return "Une opération de même montant et même date de valeur vient d'apparaître : vérifie, puis confirme."
    case 'value_date_too_early':
      return 'La date de valeur doit suivre celle du solde initial.'
    case 'value_date_too_far':
      return 'Date de valeur trop lointaine.'
    case 'category_not_choosable':
      return "Cette catégorie n'est plus choisissable (archivée, ou elle a des sous-catégories) : les données ont été rechargées."
    case 'parts_sum':
    case 'part_sign':
    case 'no_parts':
    case 'too_many_parts':
      return 'La répartition ne tombe pas juste.'
    case 'part_uncategorized':
      return 'Chaque part a une catégorie.'
    case 'uncategorize_refused':
      return "Une opération catégorisée ne revient pas « à catégoriser »."
    case 'bank_fields':
      return "Les champs de la banque d'une opération importée ne changent pas."
    case 'not_manual':
      return 'Seul un ajout manuel peut être supprimé.'
    case 'operation_archived':
      return 'Cette opération a été supprimée : les données ont été rechargées.'
    // Restore (lot 11): refused at the first lot, nothing written.
    case 'not_empty':
      return "La base n'est plus vide (une mise en service a commencé entre-temps) : rien n'est restauré."
    case 'other_environment':
      return "Cet export vient d'un autre environnement : rien n'est restauré."
    case 'schema_mismatch':
      return "La version de l'appli a changé : recharge la page, puis recommence. Rien n'est restauré."
    default:
      return lineErrorText(code) || 'Écriture refusée.'
  }
}
